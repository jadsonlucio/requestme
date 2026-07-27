import { useState } from 'react';

const BODY_TYPES = ['none', 'json', 'form', 'raw'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

function parseFormBody(body) {
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([key, value]) => ({ key, value: String(value), enabled: true }));
    }
    return [];
  } catch { return []; }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function BodyTab({ bodyType, body, onChangeType, onChangeBody }) {
  const [fileErrors, setFileErrors] = useState({});

  function handleTypeChange(type) {
    onChangeType(type);
    if (type === 'form' && !body) onChangeBody(JSON.stringify([]));
  }

  function addFormRow() {
    const rows = parseFormBody(body);
    onChangeBody(JSON.stringify([...rows, { key: '', value: '', enabled: true, type: 'text' }]));
  }

  function updateFormRow(index, fields) {
    const rows = parseFormBody(body).map((r, i) => (i === index ? { ...r, ...fields } : r));
    onChangeBody(JSON.stringify(rows));
  }

  function removeFormRow(index) {
    const rows = parseFormBody(body).filter((_, i) => i !== index);
    onChangeBody(JSON.stringify(rows));
    setFileErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }

  function toggleFormRow(index) {
    const rows = parseFormBody(body);
    updateFormRow(index, { enabled: !rows[index].enabled });
  }

  function setRowType(index, type) {
    setFileErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    updateFormRow(index, { type, value: '', fileName: undefined, mimeType: undefined });
  }

  async function handleFilePick(index, e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileErrors((prev) => ({ ...prev, [index]: 'File exceeds 5MB limit' }));
      return;
    }

    setFileErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });

    const base64 = await readFileAsBase64(file);
    updateFormRow(index, { value: base64, fileName: file.name, mimeType: file.type || 'application/octet-stream' });
  }

  return (
    <div>
      <div className="flex gap-1 mb-3">
        {BODY_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => handleTypeChange(t)}
            className={`px-2 py-0.5 text-xs rounded ${
              bodyType === t
                ? 'bg-gray-600 text-gray-100'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {bodyType === 'none' && (
        <p className="text-gray-600 text-xs">This request has no body.</p>
      )}

      {bodyType === 'json' && (
        <textarea
          value={body}
          onChange={(e) => onChangeBody(e.target.value)}
          placeholder={'{\n  "key": "value"\n}'}
          spellCheck={false}
          className="w-full h-64 bg-gray-700 text-gray-100 rounded px-3 py-2 text-xs outline-none font-mono resize-none"
        />
      )}

      {bodyType === 'raw' && (
        <textarea
          value={body}
          onChange={(e) => onChangeBody(e.target.value)}
          placeholder="Raw body content"
          spellCheck={false}
          className="w-full h-64 bg-gray-700 text-gray-100 rounded px-3 py-2 text-xs outline-none font-mono resize-none"
        />
      )}

      {bodyType === 'form' && (
        <div className="space-y-1">
          {parseFormBody(body).map((row, i) => {
            const rowType = row.type === 'file' ? 'file' : 'text';
            return (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={row.enabled !== false}
                    onChange={() => toggleFormRow(i)}
                    className="accent-blue-500"
                  />
                  <input
                    value={row.key}
                    onChange={(e) => updateFormRow(i, { key: e.target.value })}
                    placeholder="Key"
                    className={`flex-1 bg-gray-700 rounded px-2 py-1 text-xs outline-none ${
                      row.enabled === false ? 'opacity-40 text-gray-500' : 'text-gray-100'
                    }`}
                  />
                  <div className="flex text-[10px] rounded overflow-hidden shrink-0">
                    <button
                      onClick={() => setRowType(i, 'text')}
                      className={`px-1.5 py-1 ${rowType === 'text' ? 'bg-gray-600 text-gray-100' : 'bg-gray-700 text-gray-500'}`}
                    >
                      Text
                    </button>
                    <button
                      onClick={() => setRowType(i, 'file')}
                      className={`px-1.5 py-1 ${rowType === 'file' ? 'bg-gray-600 text-gray-100' : 'bg-gray-700 text-gray-500'}`}
                    >
                      File
                    </button>
                  </div>
                  {rowType === 'text' ? (
                    <input
                      value={row.value}
                      onChange={(e) => updateFormRow(i, { value: e.target.value })}
                      placeholder="Value"
                      className={`flex-1 bg-gray-700 rounded px-2 py-1 text-xs outline-none ${
                        row.enabled === false ? 'opacity-40 text-gray-500' : 'text-gray-100'
                      }`}
                    />
                  ) : (
                    <div className="flex-1 flex items-center gap-1 min-w-0">
                      <label className="px-2 py-1 text-xs bg-gray-700 rounded text-gray-300 hover:text-gray-100 cursor-pointer shrink-0">
                        Choose File
                        <input type="file" onChange={(e) => handleFilePick(i, e)} className="hidden" />
                      </label>
                      {row.fileName && (
                        <span className="text-xs text-gray-400 truncate">{row.fileName}</span>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => removeFormRow(i)}
                    className="text-red-500 hover:text-red-400 text-xs shrink-0"
                  >
                    ×
                  </button>
                </div>
                {fileErrors[i] && (
                  <p className="text-red-500 text-[10px] ml-6 mt-0.5">{fileErrors[i]}</p>
                )}
              </div>
            );
          })}
          <button onClick={addFormRow} className="mt-2 text-xs text-blue-400 hover:text-blue-300">
            + Add Field
          </button>
        </div>
      )}
    </div>
  );
}
