import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateRequest } from '../../api/requests';
import { sendRequest } from '../../api/proxy';
import { getEnvironments } from '../../api/environments';
import useStore from '../../store';
import HeadersTab from './HeadersTab';
import BodyTab from './BodyTab';
import AuthTab from './AuthTab';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const METHOD_BG = {
  GET: 'text-green-400',
  POST: 'text-yellow-400',
  PUT: 'text-blue-400',
  PATCH: 'text-orange-400',
  DELETE: 'text-red-400',
  HEAD: 'text-purple-400',
  OPTIONS: 'text-gray-400',
};

export default function RequestEditor({ onResponse, isSending, setIsSending }) {
  const queryClient = useQueryClient();
  const activeRequest = useStore((s) => s.activeRequest);
  const updateActiveRequest = useStore((s) => s.updateActiveRequest);
  const activeEnvironmentId = useStore((s) => s.activeEnvironmentId);

  const [tab, setTab] = useState('headers');
  const [localRequest, setLocalRequest] = useState(null);

  useEffect(() => {
    if (activeRequest) {
      setLocalRequest(activeRequest);
    } else {
      setLocalRequest(null);
    }
  }, [activeRequest?.id]);

  const saveMutation = useMutation({
    mutationFn: ({ id, data }) => updateRequest(id, data),
    onSuccess: (updated) => {
      updateActiveRequest(updated);
      queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
  });

  function handleFieldChange(field, value) {
    setLocalRequest((r) => ({ ...r, [field]: value }));
    saveMutation.mutate({ id: localRequest.id, data: { [field]: value } });
  }

  async function handleSend() {
    if (!localRequest || isSending) return;
    setIsSending(true);
    onResponse(null);

    let variables = {};
    if (activeEnvironmentId) {
      try {
        const envs = await getEnvironments(localRequest.project_id || 0);
        const activeEnv = envs.find((e) => e.id === activeEnvironmentId);
        if (activeEnv) {
          variables = Object.fromEntries(activeEnv.variables.map((v) => [v.key, v.value]));
        }
      } catch {}
    }

    try {
      const result = await sendRequest({
        method: localRequest.method,
        url: localRequest.url,
        headers: localRequest.headers || [],
        body_type: localRequest.body_type,
        body: localRequest.body,
        auth_type: localRequest.auth_type,
        auth_config: localRequest.auth_config || {},
        variables,
      });
      onResponse({ ...result, requestUrl: localRequest.url });
    } finally {
      setIsSending(false);
    }
  }

  if (!localRequest) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
        Select a request from the sidebar
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 p-3 border-b border-gray-700">
        <select
          value={localRequest.method}
          onChange={(e) => handleFieldChange('method', e.target.value)}
          className={`bg-gray-700 rounded px-2 py-1.5 text-xs font-bold outline-none ${METHOD_BG[localRequest.method] || 'text-gray-300'}`}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <input
          value={localRequest.url}
          onChange={(e) => setLocalRequest((r) => ({ ...r, url: e.target.value }))}
          onBlur={(e) => saveMutation.mutate({ id: localRequest.id, data: { url: e.target.value } })}
          placeholder="https://api.example.com/endpoint"
          className="flex-1 bg-gray-700 text-gray-100 rounded px-3 py-1.5 text-xs outline-none"
        />

        <button
          onClick={handleSend}
          disabled={isSending || !localRequest.url}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs rounded font-medium"
        >
          {isSending ? 'Sending…' : 'Send'}
        </button>
      </div>

      <div className="flex border-b border-gray-700 px-3">
        {['headers', 'body', 'auth'].map((t) => (
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

      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'headers' && (
          <HeadersTab
            headers={localRequest.headers || []}
            onChange={(headers) => handleFieldChange('headers', headers)}
          />
        )}
        {tab === 'body' && (
          <BodyTab
            bodyType={localRequest.body_type}
            body={localRequest.body}
            onChangeType={(body_type) => handleFieldChange('body_type', body_type)}
            onChangeBody={(body) => handleFieldChange('body', body)}
          />
        )}
        {tab === 'auth' && (
          <AuthTab
            authType={localRequest.auth_type}
            authConfig={localRequest.auth_config || {}}
            onChangeType={(auth_type) => handleFieldChange('auth_type', auth_type)}
            onChangeConfig={(auth_config) => handleFieldChange('auth_config', auth_config)}
          />
        )}
      </div>
    </div>
  );
}
