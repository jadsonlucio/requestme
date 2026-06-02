// Returns: 'json' | 'text' | 'svg' | 'image' | 'video' | 'audio' | 'binary'
export function classifyContentType(contentType) {
  if (!contentType) return 'binary';
  const ct = contentType.split(';')[0].trim().toLowerCase();
  if (ct === 'application/json' || ct.includes('+json')) return 'json';
  if (ct === 'image/svg+xml') return 'svg';
  if (
    ct.startsWith('text/') ||
    ct === 'application/xml' ||
    ct.includes('+xml') ||
    ct === 'application/javascript' ||
    ct === 'application/x-javascript'
  ) return 'text';
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';
  return 'binary';
}
