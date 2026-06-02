const MIME_TO_EXT = {
  'application/json': 'json',
  'application/xml': 'xml',
  'application/javascript': 'js',
  'application/x-javascript': 'js',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/octet-stream': 'bin',
  'text/html': 'html',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/xml': 'xml',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'weba',
};

export function resolveFilename(responseHeaders, requestUrl, contentType) {
  // 1. Content-Disposition header
  const disposition = responseHeaders['content-disposition'];
  if (disposition) {
    const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i);
    if (match) {
      const raw = match[1].trim().split(/[/\\]/).pop();
      if (raw) {
        const name = /filename\*=/i.test(disposition) ? decodeURIComponent(raw) : raw;
        return name;
      }
    }
  }

  // 2. Last path segment of request URL if it has an extension
  try {
    const pathname = new URL(requestUrl).pathname;
    const segment = pathname.split('/').pop();
    if (segment && /\.\w{1,5}$/.test(segment)) return segment;
  } catch {}

  // 3. Fallback: "response.<ext>" or "response"
  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  const ext = MIME_TO_EXT[ct];
  return ext ? `response.${ext}` : 'response';
}
