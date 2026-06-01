export const DEFAULT_USER_QUOTA_BYTES = 1024 * 1024 * 1024;
export const MAX_FILE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_FILES_PER_BATCH = 200;
export const MAX_UPLOAD_BATCH_BYTES = 200 * 1024 * 1024;
export const MAX_PATH_DEPTH = 12;
export const MAX_PATH_LENGTH = 512;
export const MAX_PATH_SEGMENT_LENGTH = 120;
export const MAX_DIRECTORY_CHILDREN = 1000;
export const MAX_USER_FILE_ITEMS = 10000;
export const MAX_RENAME_ATTEMPTS = 100;
export const MAX_WALK_ITEMS = 20000;

export function configuredUserQuotaBytes() {
  return positiveInteger(process.env.KNBOX_USER_QUOTA_BYTES, DEFAULT_USER_QUOTA_BYTES);
}

export function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

export function assertBatchLimits(paths, totalBytes = 0) {
  const count = Array.isArray(paths) ? paths.length : 0;
  if (count > MAX_UPLOAD_FILES_PER_BATCH) {
    throw statusError(`一次最多上传 ${MAX_UPLOAD_FILES_PER_BATCH} 个文件。`, 413);
  }
  if (Number(totalBytes) > MAX_UPLOAD_BATCH_BYTES) {
    throw statusError(`一次上传总大小不能超过 ${formatBytes(MAX_UPLOAD_BATCH_BYTES)}。`, 413);
  }
}

export function assertPathPolicy(parts, label = "file path") {
  const normalizedParts = Array.isArray(parts) ? parts : [];
  const normalizedPath = normalizedParts.join("/");
  if (normalizedParts.length > MAX_PATH_DEPTH) {
    throw statusError(`Invalid ${label}: maximum depth is ${MAX_PATH_DEPTH}.`, 400);
  }
  if (normalizedPath.length > MAX_PATH_LENGTH) {
    throw statusError(`Invalid ${label}: maximum length is ${MAX_PATH_LENGTH} characters.`, 400);
  }
  if (normalizedParts.some((part) => part.length > MAX_PATH_SEGMENT_LENGTH)) {
    throw statusError(`Invalid ${label}: path segments cannot exceed ${MAX_PATH_SEGMENT_LENGTH} characters.`, 400);
  }
}

export function statusError(message, status = 400, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024 / 1024)}GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}
