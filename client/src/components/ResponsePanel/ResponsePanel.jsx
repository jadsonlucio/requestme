import { useState } from 'react';
import { resolveFilename } from '../../utils/filename';
import { classifyContentType } from '../../utils/contentType';

const STATUS_COLOR = (status) => {
  if (!status) return 'text-gray-500';
  if (status >= 200 && status < 300) return 'text-green-400';
  if (status >= 300 && status < 400) return 'text-yellow-400';
  if (status >= 400) return 'text-red-400';
  return 'text-gray-500';
};

function tryPrettyPrint(body) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function DownloadButton({ response }) {
  const headers = response.headers || {};
  const contentType = headers['content-type'] || '';
  const filename = resolveFilename(headers, response.requestUrl || '', contentType);

  function handleTextDownload() {
    const blob = new Blob([response.body], { type: contentType || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const btnClass = 'ml-auto text-xs text-gray-400 hover:text-gray-200 px-2 py-0.5 rounded border border-gray-600 hover:border-gray-400 transition-colors';

  if (response.previewToken) {
    return (
      <a
        href={`/api/proxy/preview/${response.previewToken}`}
        download={filename}
        className={btnClass}
      >
        Download
      </a>
    );
  }

  return (
    <button onClick={handleTextDownload} className={btnClass}>
      Download
    </button>
  );
}

function FileIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

const EXT_TO_KIND = {
  mp4: 'video', webm: 'video', ogv: 'video', ogg: 'video', mov: 'video', avi: 'video', mkv: 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', m4a: 'audio', aac: 'audio', opus: 'audio',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', ico: 'image',
  svg: 'svg',
};

function classifyByExtension(filename) {
  if (!filename) return null;
  const ext = filename.split('.').pop()?.toLowerCase();
  return EXT_TO_KIND[ext] || null;
}

function extractFilename(disposition) {
  if (!disposition) return null;
  const m = disposition.match(/filename=["']?([^"';\r\n]+)["']?/i);
  return m ? m[1].trim() : null;
}

function PreviewContent({ contentType, disposition, previewToken }) {
  const src = `/api/proxy/preview/${previewToken}`;
  let kind = classifyContentType(contentType);

  if (kind === 'binary') {
    kind = classifyByExtension(extractFilename(disposition)) || 'binary';
  }

  if (kind === 'image' || kind === 'svg') {
    return (
      <img
        src={src}
        alt="response preview"
        className="max-w-full max-h-full object-contain"
      />
    );
  }
  if (kind === 'video') {
    return (
      <video controls src={src} className="max-w-full max-h-full">
        Your browser does not support video playback.
      </video>
    );
  }
  if (kind === 'audio') {
    return <audio controls src={src} className="w-full" />;
  }

  // Unknown binary — show file icon + extension from filename or content-type
  const filename = extractFilename(disposition);
  const ext = filename?.includes('.')
    ? filename.split('.').pop()
    : contentType?.split(';')[0].trim().split('/')[1] || null;

  return (
    <div className="flex flex-col items-center gap-2 text-gray-400">
      <FileIcon />
      <span className="text-xs">{ext ? `.${ext}` : contentType || 'unknown'}</span>
    </div>
  );
}

export default function ResponsePanel({ response, isSending }) {
  const [tab, setTab] = useState('pretty');
  const [copied, setCopied] = useState(false);

  function handleCopy(text) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (isSending) {
    return (
      <div className="w-96 shrink-0 flex items-center justify-center text-gray-500 text-xs">
        Sending…
      </div>
    );
  }

  if (!response) {
    return (
      <div className="w-96 shrink-0 flex items-center justify-center text-gray-600 text-xs">
        Hit Send to see the response
      </div>
    );
  }

  if (response.error || response.status === 0) {
    return (
      <div className="w-96 shrink-0 flex flex-col p-4">
        <div className="text-red-400 text-xs font-medium mb-2">Network Error</div>
        <div className="text-red-300 text-xs bg-gray-700 rounded p-3">{response.error}</div>
        {response.time_ms !== undefined && (
          <div className="mt-2 text-gray-600 text-xs">{response.time_ms}ms</div>
        )}
      </div>
    );
  }

  const responseHeaders = response.headers || {};
  const prettyBody = tryPrettyPrint(response.body || '');
  const isBinary = !!(response && response.previewToken);
  const tabs = isBinary ? ['preview', 'headers'] : ['pretty', 'raw', 'headers'];
  const activeTab = tabs.includes(tab) ? tab : tabs[0];

  return (
    <div className="w-96 shrink-0 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-700 shrink-0">
        <span className={`text-xs font-bold ${STATUS_COLOR(response.status)}`}>
          {response.status} {response.statusText}
        </span>
        <span className="text-gray-500 text-xs">{response.time_ms}ms</span>
        <span className="text-gray-600 text-xs">
          {responseHeaders['content-length']
            ? `${responseHeaders['content-length']} B`
            : response.body != null ? `${response.body.length} B` : ''}
        </span>
        <DownloadButton response={response} />
      </div>

      <div className="flex border-b border-gray-700 px-3 shrink-0">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs capitalize ${
              activeTab === t ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'pretty' && (
          <div className="relative">
            {prettyBody && (
              <button
                onClick={() => handleCopy(prettyBody)}
                className="absolute top-2 right-2 text-xs text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded border border-gray-700 hover:border-gray-500 bg-gray-900/80 transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            )}
            <pre className="p-3 text-xs text-gray-200 whitespace-pre-wrap break-all font-mono">
              {prettyBody || <span className="text-gray-600">Empty response</span>}
            </pre>
          </div>
        )}
        {activeTab === 'raw' && (
          <pre className="p-3 text-xs text-gray-200 whitespace-pre-wrap break-all font-mono">
            {response.body || <span className="text-gray-600">Empty response</span>}
          </pre>
        )}
        {activeTab === 'preview' && (
          <div className="flex-1 flex items-center justify-center p-4 min-h-48">
            <PreviewContent
              contentType={responseHeaders['content-type']}
              disposition={responseHeaders['content-disposition']}
              previewToken={response.previewToken}
            />
          </div>
        )}
        {activeTab === 'headers' && (
          <div className="p-3 space-y-1">
            {Object.entries(responseHeaders).map(([key, value]) => (
              <div key={key} className="flex gap-2 text-xs">
                <span className="text-gray-400 shrink-0">{key}:</span>
                <span className="text-gray-200 break-all">{value}</span>
              </div>
            ))}
            {Object.keys(responseHeaders).length === 0 && (
              <span className="text-gray-600">No headers</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
