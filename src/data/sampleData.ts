import { WritingProject } from '../types';

export function createSampleGrandmaProject(): WritingProject {
  const sampleDraft = `Trong gia đình em, bà nội là người gần gũi và yêu thương em nhất. Năm nay bà đã ngoài bảy mươi tuổi nhưng vẫn còn rất minh mẫn.

Dáng bà hơi còng vì bao năm vất vả chăm lo cho con cháu. Mái tóc bà đã bạc trắng, thường được búi gọn gàng sau gáy. Khuôn mặt bà có nhiều nếp nhăn nhưng lúc nào cũng hiền hậu. Đôi mắt bà tuy hơi mờ nhưng ánh lên vẻ dịu dàng mỗi khi nhìn em. Bàn tay bà gầy gầy, nổi rõ những đường gân xanh.

Bà nội rất hiền và kiên nhẫn. Buổi sáng nào bà cũng dậy sớm tưới mấy chậu hoa ngoài sân rồi gọi em thức dậy đi học. Mỗi khi em đi học về, bà hay hỏi thăm hôm nay ở lớp có chuyện gì vui. Khi em làm bài toán khó, bà ngồi bên cạnh quạt mát và động viên em cố gắng làm lại.

Em rất yêu quý bà nội. Em mong bà luôn mạnh khỏe để sống thật lâu cùng gia đình em.`;

  const nowIso = new Date().toISOString();

  return {
    id: `sample-ba-noi-${Date.now()}`,
    currentStep: 1,
    personChoice: 'Bà',
    customPersonLabel: '',
    observations: {
      ngoaiHinh: [
        'Dáng bà hơi còng vì bao năm vất vả',
        'Mái tóc bạc trắng, búi gọn gàng sau gáy',
        'Khuôn mặt nhiều nếp nhăn, đôi mắt hiền dịu',
        'Bàn tay gầy, nổi rõ những đường gân xanh',
      ],
      tinhTinh: [
        'Hiền hậu, kiên nhẫn và chăm chỉ',
      ],
      hoatDongLoiNoi: [
        'Sáng sớm tưới hoa ngoài sân, gọi em dậy đi học',
        'Chiều hỏi thăm chuyện lớp, ngồi quạt và động viên em học bài',
      ],
      tinhCam: [
        'Rất yêu quý bà nội và mong bà luôn mạnh khỏe, sống lâu cùng gia đình',
      ],
    },
    observationPrompts: {
      ngoaiHinh: 'Khi bà cười, đôi mắt và khuôn mặt bà trông thế nào hả bạn?',
    },
    outline: {
      moBai: 'Giới thiệu bà nội (ngoài bảy mươi tuổi, người em gần gũi và yêu quý nhất trong nhà).',
      ngoaiHinh: [
        'Dáng bà hơi còng vì bao năm vất vả',
        'Mái tóc bạc trắng, búi gọn gàng sau gáy',
        'Khuôn mặt nhiều nếp nhăn, đôi mắt hiền dịu',
        'Bàn tay gầy, nổi rõ những đường gân xanh',
      ],
      tinhTinhHoatDong: [
        'Hiền hậu, kiên nhẫn và chăm chỉ',
        'Sáng sớm tưới hoa ngoài sân, gọi em dậy đi học',
        'Chiều hỏi thăm chuyện lớp, ngồi quạt và động viên em học bài',
      ],
      ketBai: 'Bày tỏ lòng yêu quý bà nội và lời chúc bà luôn mạnh khỏe, sống lâu cùng gia đình.',
    },
    outlineSyncedFromStep1: true,
    outlineCheck: null,
    chatMessages: [
      {
        id: 'sample-msg-1',
        role: 'assistant',
        text: 'Chào bạn! Mình thấy bạn đã ghi nhiều ý ấm áp về bà nội. Bạn có nhớ giọng nói của bà nghe thế nào không?',
        timestamp: nowIso,
      },
    ],
    suggestedWords: ['bạc phơ', 'hiền từ', 'ấm áp', 'nếp nhăn', 'búi gọn', 'tần tảo'],
    suggestedWordTopic: 'Mái tóc & khuôn mặt',
    savedWords: ['bạc phơ', 'hiền từ', 'ấm áp'],
    khoTuStats: {
      mo_kho: 0,
      goi_y_tu_kho: 0,
      tu_da_luu: 0,
      auto_fallback: 0,
    },
    seenKhoQuestions: [],
    draftText: sampleDraft,
    draftLocked: false,
    draftLockedAt: null,
    revisedText: sampleDraft,
    selfCheck: {
      duBaPhan: null,
      baNetNgoaiHinh: null,
      viecLamLoiNoi: null,
      hinhAnhSoSanh: null,
      ketBaiTinhCam: null,
      suaChinhTa: null,
    },
    essayReviews: [],
    selfRating: {
      boCuc: 0,
      ngoaiHinh: 0,
      tinhTinhHoatDong: 0,
      camXuc: 0,
      dungTuChinhTa: 0,
    },
    aiCallCount: 0,
    feedbackHistory: [
      {
        id: 'sample-hist-1',
        step: 1,
        kind: 'quan_sat',
        title: 'Gợi nhớ ô Ngoại hình',
        promptSummary: 'Tả Bà — Ngoại hình',
        responseSummary: 'Khi bà cười, đôi mắt và khuôn mặt bà trông thế nào hả bạn?',
        timestamp: nowIso,
      },
    ],
    lastSavedAt: nowIso,
  };
}
