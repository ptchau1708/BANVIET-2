import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  FIXED_SYSTEM_INSTRUCTION,
  GopYBaiResponse,
  KiemTraDanYResponse,
  ValidatedGoiYInput,
  ValidatedGopYBaiInput,
  ValidatedKiemTraDanYInput,
  sanitizeGopYBaiResponse,
  sanitizeKiemTraDanYResponse,
  sanitizeWordBank,
} from './validation.ts';

// Fixed Gemini Flash model locked on server; client cannot select or override.
const FIXED_GEMINI_FLASH_MODEL = 'gemini-4-hydrogen';

let cachedClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'Chưa cấu hình khóa GEMINI_API_KEY ở máy chủ. Hãy kiểm tra phần Secrets rồi thử lại.'
    );
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

function parseJsonSafely<T>(rawText: string | undefined, fallbackError: string): T {
  const cleaned = (rawText ?? '').trim();
  if (!cleaned) {
    throw new Error(fallbackError);
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as T;
    }
    throw new Error(fallbackError);
  }
}

export async function runGoiY(input: ValidatedGoiYInput): Promise<{
  tra_loi?: string;
  tu_ngu?: string[];
}> {
  const ai = getGeminiClient();

  if (input.che_do === 'kho_tu_ngu') {
    const stepInstruction = `${FIXED_SYSTEM_INSTRUCTION}

NHIỆM VỤ RIÊNG (BƯỚC 2 - KHO TỪ NGỮ):
- Học sinh đang lập ý tả "${input.nguoi_ta}", phần/khía cạnh: "${input.muc || 'ngoại hình hoặc tính tình'}".
- Chỉ trả về 6 đến 8 TỪ ĐƠN LẺ hoặc CỤM TỪ NGẮN (2–4 từ) giàu hình ảnh, phù hợp học sinh lớp 5 Việt Nam.
- TUYỆT ĐỐI KHÔNG viết thành câu hoàn chỉnh có chủ ngữ - vị ngữ.
- Kèm 1 lời nhắn ngắn gọn tối đa 25 từ khích lệ bạn chọn từ hợp với "${input.nguoi_ta}" và 1 câu hỏi nhỏ.`;

    const userContent = `Người được tả: <nguoi_ta>${input.nguoi_ta}</nguoi_ta>
Khía cạnh đang tìm từ: <muc>${input.muc || 'Ngoại hình'}</muc>
Các ý bạn đã ghi: <ghi_chu>${input.ghi_chu.join('; ') || 'Chưa ghi nhiều'}</ghi_chu>
Gợi ý thêm (nếu có): <yeu_cau>${input.tin_nhan || 'Tìm từ ngữ gợi tả phù hợp'}</yeu_cau>`;

    const response = await ai.models.generateContent({
      model: FIXED_GEMINI_FLASH_MODEL,
      contents: userContent,
      config: {
        systemInstruction: stepInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            tu_ngu: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '6 đến 8 từ đơn lẻ hoặc cụm từ ngắn (tối đa 4 tiếng), không phải câu.',
            },
            loi_nhan: {
              type: Type.STRING,
              description: 'Lời nhắn thân thiện tối đa 25 từ kèm 1 câu hỏi gợi mở.',
            },
          },
          required: ['tu_ngu', 'loi_nhan'],
        },
      },
    });

    const parsed = parseJsonSafely<{ tu_ngu?: string[]; loi_nhan?: string }>(
      response.text,
      'Bạn Viết chưa lấy được kho từ ngữ lúc này. Em thử bấm lại nhé!'
    );

    const words = sanitizeWordBank(parsed.tu_ngu);
    return {
      tu_ngu: words,
      tra_loi:
        typeof parsed.loi_nhan === 'string' && parsed.loi_nhan.trim()
          ? parsed.loi_nhan.trim()
          : 'Mình gợi ý mấy từ ngắn này, từ nào giống người bạn đang tả nhất?',
    };
  }

  if (input.che_do === 'quan_sat') {
    const stepInstruction = `${FIXED_SYSTEM_INSTRUCTION}

NHIỆM VỤ RIÊNG (BƯỚC 1 - QUAN SÁT):
- Học sinh đang ghi phiếu quan sát tả "${input.nguoi_ta}", ở ô: "${input.muc}".
- Dựa vào những ý ngắn bạn đã ghi trong ô này (nếu chưa ghi thì gợi mở từ đầu), hãy đặt ĐÚNG 1 CÂU HỎI gợi nhớ cụ thể để bạn nhớ ra thêm chi tiết sinh động.
- KHÔNG viết câu văn mẫu, KHÔNG viết thay bạn.
- Toàn bộ câu trả lời tối đa 40 từ và chỉ chứa đúng 1 dấu hỏi.`;

    const userContent = `Người được tả: <nguoi_ta>${input.nguoi_ta}</nguoi_ta>
Ô quan sát: <muc>${input.muc}</muc>
Những ý bạn đã ghi trong ô này:
<ghi_chu>${input.ghi_chu.length > 0 ? input.ghi_chu.map((s) => `- ${s}`).join('\n') : '(Chưa ghi ý nào)'}</ghi_chu>`;

    const response = await ai.models.generateContent({
      model: FIXED_GEMINI_FLASH_MODEL,
      contents: userContent,
      config: {
        systemInstruction: stepInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const text = (response.text ?? '').trim();
    if (!text) {
      throw new Error('Bạn Viết chưa trả lời kịp. Em thử bấm lại nhé!');
    }
    return { tra_loi: text };
  }

  // che_do === 'tro_chuyen' (Step 2 chat)
  const stepInstruction = `${FIXED_SYSTEM_INSTRUCTION}

NHIỆM VỤ RIÊNG (BƯỚC 2 - TRÒ CHUYỆN LẬP Ý):
- Học sinh đang lập dàn ý tả "${input.nguoi_ta}".
- Chỉ trò chuyện để giúp bạn nghĩ thêm ý, sắp xếp ý hoặc chọn từ ngữ ngắn.
- Tuyệt đối tuân thủ quy tắc: KHÔNG viết câu văn/đoạn văn mẫu kể cả khi bạn năn nỉ; mỗi lượt tối đa 40 từ và chỉ đúng 1 câu hỏi.`;

  const historyText =
    input.lich_su_chat.length > 0
      ? input.lich_su_chat
          .map((m) => `${m.role === 'user' ? 'Bạn học sinh' : 'Bạn Viết'}: ${m.text}`)
          .join('\n')
      : '(Mới bắt đầu trò chuyện)';

  const userContent = `Người được tả: <nguoi_ta>${input.nguoi_ta}</nguoi_ta>
Tóm tắt dàn ý hiện tại:
<dan_y>${input.dan_y_tom_tat || '(Đang bắt đầu lập ý)'}</dan_y>
Lịch sử trò chuyện gần đây:
<lich_su>${historyText}</lich_su>
Tin nhắn mới của bạn học sinh:
<noi_dung_hoc_sinh>${input.tin_nhan}</noi_dung_hoc_sinh>`;

  const response = await ai.models.generateContent({
    model: FIXED_GEMINI_FLASH_MODEL,
    contents: userContent,
    config: {
      systemInstruction: stepInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Bạn Viết chưa trả lời kịp. Em thử gửi lại nhé!');
  }
  return { tra_loi: text };
}

export async function runKiemTraDanY(
  input: ValidatedKiemTraDanYInput
): Promise<KiemTraDanYResponse> {
  const ai = getGeminiClient();

  const stepInstruction = `${FIXED_SYSTEM_INSTRUCTION}

NHIỆM VỤ RIÊNG (BƯỚC 2 - KIỂM TRA DÀN Ý):
- Đánh giá dàn ý tả "${input.nguoi_ta}" theo đúng yêu cầu lớp 5:
  1. Đủ 3 phần (Mở bài, Thân bài, Kết bài) -> du_3_phan: true/false.
  2. Đếm số chi tiết ngoại hình rõ ràng (so_chi_tiet_ngoai_hinh). Cần ít nhất 3 chi tiết để đạt.
  3. Đếm số chi tiết tính tình hoặc hoạt động, lời nói rõ ràng (so_chi_tiet_tinh_tinh_hoat_dong). Cần ít nhất 2 chi tiết để đạt.
  4. Liệt kê ngắn gọn phan_con_thieu (mảng rỗng nếu đã đủ tất cả).
  5. Đặt tối đa 2 câu hỏi gợi mở (cau_hoi_goi_y) giúp bạn bổ sung phần còn thiếu hoặc làm rõ nét riêng; KHÔNG viết câu văn thay bạn, KHÔNG chấm điểm số.`;

  const userContent = `Người được tả: <nguoi_ta>${input.nguoi_ta}</nguoi_ta>
<dan_y>
Mở bài: ${input.dan_y.mo_bai || '(Chưa ghi)'}
Thân bài - Tả ngoại hình:
${input.dan_y.ngoai_hinh.length > 0 ? input.dan_y.ngoai_hinh.map((x) => `- ${x}`).join('\n') : '(Chưa ghi)'}
Thân bài - Tả tính tình, hoạt động:
${input.dan_y.tinh_tinh_hoat_dong.length > 0 ? input.dan_y.tinh_tinh_hoat_dong.map((x) => `- ${x}`).join('\n') : '(Chưa ghi)'}
Kết bài: ${input.dan_y.ket_bai || '(Chưa ghi)'}
</dan_y>`;

  const response = await ai.models.generateContent({
    model: FIXED_GEMINI_FLASH_MODEL,
    contents: userContent,
    config: {
      systemInstruction: stepInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          du_3_phan: {
            type: Type.BOOLEAN,
            description: 'True nếu dàn ý có đủ Mở bài, Thân bài và Kết bài.',
          },
          so_chi_tiet_ngoai_hinh: {
            type: Type.INTEGER,
            description: 'Số chi tiết ngoại hình riêng biệt học sinh đã nêu.',
          },
          so_chi_tiet_tinh_tinh_hoat_dong: {
            type: Type.INTEGER,
            description: 'Số chi tiết tính tình, việc làm hoặc lời nói học sinh đã nêu.',
          },
          phan_con_thieu: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Danh sách các phần hoặc yêu cầu còn thiếu (rỗng nếu đã đạt hết).',
          },
          cau_hoi_goi_y: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Tối đa 2 câu hỏi gợi mở ngắn gọn, ấm áp; không viết câu mẫu.',
          },
        },
        required: [
          'du_3_phan',
          'so_chi_tiet_ngoai_hinh',
          'so_chi_tiet_tinh_tinh_hoat_dong',
          'phan_con_thieu',
          'cau_hoi_goi_y',
        ],
      },
    },
  });

  const parsed = parseJsonSafely<unknown>(
    response.text,
    'Bạn Viết chưa đọc xong dàn ý. Em bấm kiểm tra lại nhé!'
  );
  return sanitizeKiemTraDanYResponse(parsed);
}

export async function runGopYBai(input: ValidatedGopYBaiInput): Promise<GopYBaiResponse> {
  const ai = getGeminiClient();

  const stepInstruction = `${FIXED_SYSTEM_INSTRUCTION}

NHIỆM VỤ RIÊNG (BƯỚC 4 - ĐỌC GIÚP VÀ GÓP Ý BÀI VĂN):
- Đọc bài văn tả "${input.nguoi_ta}" của bạn học sinh lớp 5 (đây là lần nhờ đọc thứ ${input.lan_thu}/3).
- Trả về JSON gồm đúng 2 trường:
  1. "loi_khen": Đúng 1 câu khen cụ thể một chi tiết hay, chân thật trong bài bạn viết.
  2. "gop_y": Mảng gồm 2 đến 3 mục. Mỗi mục gồm đúng 3 trường:
     - "trich_doan": Chép NGUYÊN VĂN chính xác từng chữ (tối đa 12 từ) lấy trực tiếp từ bài văn của bạn để máy tô vàng đúng vị trí đó.
     - "loai": Một trong 5 giá trị: "chi_tiet" | "dung_tu" | "cau" | "bo_cuc" | "chinh_ta".
     - "cau_hoi_goi_y": Một câu hỏi gợi mở ấm áp, ngắn gọn giúp bạn tự suy nghĩ cách sửa chỗ đó. TUYỆT ĐỐI KHÔNG viết lại câu hộ bạn, KHÔNG đưa câu sửa mẫu.`;

  const userContent = `Người được tả: <nguoi_ta>${input.nguoi_ta}</nguoi_ta>
Bài văn của bạn học sinh:
<noi_dung_hoc_sinh>
${input.bai_van}
</noi_dung_hoc_sinh>`;

  const response = await ai.models.generateContent({
    model: FIXED_GEMINI_FLASH_MODEL,
    contents: userContent,
    config: {
      systemInstruction: stepInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          loi_khen: {
            type: Type.STRING,
            description: 'Đúng 1 câu khen cụ thể một chi tiết trong bài viết của bạn.',
          },
          gop_y: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                trich_doan: {
                  type: Type.STRING,
                  description: 'Nguyên văn chính xác từ bài viết (tối đa 12 từ).',
                },
                loai: {
                  type: Type.STRING,
                  enum: ['chi_tiet', 'dung_tu', 'cau', 'bo_cuc', 'chinh_ta'],
                  description: 'Loại góp ý.',
                },
                cau_hoi_goi_y: {
                  type: Type.STRING,
                  description: 'Câu hỏi gợi mở giúp bạn tự sửa, tuyệt đối không viết câu thay.',
                },
              },
              required: ['trich_doan', 'loai', 'cau_hoi_goi_y'],
            },
            description: 'Danh sách 2 đến 3 mục góp ý cụ thể.',
          },
        },
        required: ['loi_khen', 'gop_y'],
      },
    },
  });

  const parsed = parseJsonSafely<unknown>(
    response.text,
    'Bạn Viết chưa đọc xong bài lúc này. Em thử bấm lại nhé!'
  );
  const sanitized = sanitizeGopYBaiResponse(parsed);
  if (sanitized.gop_y.length === 0) {
    throw new Error('Bạn Viết chưa tìm được đoạn trích phù hợp. Em thử bấm lại nhé!');
  }
  return sanitized;
}
