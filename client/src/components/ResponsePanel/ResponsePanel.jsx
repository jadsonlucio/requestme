import { useState } from 'react';

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

export default function ResponsePanel({ response, isSending }) {
  const [tab, setTab] = useState('pretty');

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
            : `${(response.body || '').length} B`}
        </span>
      </div>

      <div className="flex border-b border-gray-700 px-3 shrink-0">
        {['pretty', 'raw', 'headers'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs capitalize ${
              tab === t ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'pretty' && (
          <pre className="p-3 text-xs text-gray-200 whitespace-pre-wrap break-all font-mono">
            {prettyBody || <span className="text-gray-600">Empty response</span>}
          </pre>
        )}
        {tab === 'raw' && (
          <pre className="p-3 text-xs text-gray-200 whitespace-pre-wrap break-all font-mono">
            {response.body || <span className="text-gray-600">Empty response</span>}
          </pre>
        )}
        {tab === 'headers' && (
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
