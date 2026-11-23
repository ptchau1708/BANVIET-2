import { EssaySuggestion, OutlineData } from '../types';

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMsg =
      typeof payload?.error === 'string' && payload.error.trim()
        ? payload.error
        : 'Bạn Viết chưa trả lời được lúc này. Em kiểm tra mạng rồi thử lại nhé!';
    throw new Error(errorMsg);
  }
  return payload as T;
}

export interface GoiYResponse {
  tra_loi?: string;
  tu_ngu?: string[];
}

export function fetchGoiY(params: {
  buoc: 1 | 2;
  che_do: 'quan_sat' | 'tro_chuyen' | 'kho_tu_ngu';
  nguoi_ta: string;
  muc?: string;
  ghi_chu?: string[];
  tin_nhan?: string;
  lich_su_chat?: Array<{ role: 'user' | 'assistant'; text: string }>;
  dan_y_tom_tat?: string;
}): Promise<GoiYResponse> {
  return postJson<GoiYResponse>('/api/goi-y', params);
}

export interface KiemTraDanYApiResponse {
  du_3_phan: boolean;
  so_chi_tiet_ngoai_hinh: number;
  so_chi_tiet_tinh_tinh_hoat_dong: number;
  phan_con_thieu: string[];
  cau_hoi_goi_y: string[];
}

export function fetchKiemTraDanY(params: {
  nguoi_ta: string;
  dan_y: OutlineData;
}): Promise<KiemTraDanYApiResponse> {
  return postJson<KiemTraDanYApiResponse>('/api/kiem-tra-dan-y', {
    nguoi_ta: params.nguoi_ta,
    dan_y: {
      mo_bai: params.dan_y.moBai,
      ngoai_hinh: params.dan_y.ngoaiHinh,
      tinh_tinh_hoat_dong: params.dan_y.tinhTinhHoatDong,
      ket_bai: params.dan_y.ketBai,
    },
  });
}

export interface GopYBaiApiResponse {
  loi_khen: string;
  gop_y: EssaySuggestion[];
}

export function fetchGopYBai(params: {
  nguoi_ta: string;
  bai_van: string;
  lan_thu: number;
}): Promise<GopYBaiApiResponse> {
  return postJson<GopYBaiApiResponse>('/api/gop-y-bai', params);
}
