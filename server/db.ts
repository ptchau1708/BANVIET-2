import postgres from 'postgres';

let sqlInstance: ReturnType<typeof postgres> | null = null;

export function isDatabaseConfigured(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return Boolean(url && url.length > 10);
}

export function getSql(): ReturnType<typeof postgres> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new DatabaseConfigError(
      'Chưa cấu hình DATABASE_URL trong Secrets của máy chủ.'
    );
  }
  if (!sqlInstance) {
    sqlInstance = postgres(url, {
      prepare: false, // Required for PostgreSQL transaction pooler
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
    });
  }
  return sqlInstance;
}

export class DatabaseConfigError extends Error {
  statusCode = 503;
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

export interface FormattedDbError {
  status: number;
  message: string;
}

/**
 * Translates PostgreSQL error codes into clear Vietnamese messages.
 * Never attempts to bypass permission errors or alter database objects.
 */
export function formatDatabaseError(err: unknown): FormattedDbError {
  if (err instanceof DatabaseConfigError) {
    return { status: err.statusCode, message: err.message };
  }

  const pgErr = err as { code?: string; message?: string; constraint_name?: string } | null;
  const code = pgErr?.code;

  if (code === '42501') {
    return {
      status: 403,
      message:
        'Cơ sở dữ liệu từ chối quyền thực hiện thao tác này (mã lỗi PostgreSQL 42501). Vui lòng kiểm tra quyền của tài khoản DATABASE_URL trên schema banviet.',
    };
  }
  if (code === '23505') {
    return {
      status: 409,
      message: 'Dữ liệu đã tồn tại (trùng khóa duy nhất, ví dụ trùng biệt danh trong lớp hoặc mã lớp).',
    };
  }
  if (code === '23503') {
    return {
      status: 400,
      message: 'Dữ liệu liên kết không hợp lệ hoặc không còn tồn tại.',
    };
  }
  if (code === '23514') {
    return {
      status: 400,
      message: 'Giá trị gửi lên vi phạm ràng buộc kiểm tra của bảng dữ liệu.',
    };
  }
  if (code === '22P02') {
    return {
      status: 400,
      message: 'Định dạng mã định danh (UUID) hoặc dữ liệu không hợp lệ.',
    };
  }
  if (code === '42P01') {
    return {
      status: 500,
      message:
        'Không tìm thấy bảng cần thiết trong schema banviet. Vui lòng kiểm tra lại cấu trúc cơ sở dữ liệu.',
    };
  }
  if (
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    (pgErr?.message && pgErr.message.toLowerCase().includes('connect'))
  ) {
    return {
      status: 503,
      message: 'Không thể kết nối tới cơ sở dữ liệu PostgreSQL lúc này. Vui lòng thử lại sau.',
    };
  }

  return {
    status: 500,
    message: 'Có lỗi khi làm việc với cơ sở dữ liệu. Vui lòng thử lại sau.',
  };
}
