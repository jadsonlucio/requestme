const BODY_TYPES = ['none', 'json', 'form', 'raw'];

function parseFormBody(body) {
  try { return JSON.parse(body); } catch { return []; }
}

export default function BodyTab({ bodyType, body, onChangeType, onChangeBody }) {
  function handleTypeChange(type) {
    onChangeType(type);
    if (type === 'form' && !body) onChangeBody(JSON.stringify([]));
  }

  function addFormRow() {
    const rows = parseFormBody(body);
    onChangeBody(JSON.stringify([...rows, { key: '', value: '', enabled: true }]));
  }

  function updateFormRow(index, field, value) {
    const rows = parseFormBody(body).map((r, i) => (i === index ? { ...r, [field]: value } : r));
    onChangeBody(JSON.stringify(rows));
  }

  function removeFormRow(index) {
    const rows = parseFormBody(body).filter((_, i) => i !== index);
    onChangeBody(JSON.stringify(rows));
  }

  function toggleFormRow(index) {
    const rows = parseFormBody(body);
    updateFormRow(index, 'enabled', !rows[index].enabled);
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
          {parseFormBody(body).map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={row.enabled !== false}
                onChange={() => toggleFormRow(i)}
                className="accent-blue-500"
              />
              <input
                value={row.key}
                onChange={(e) => updateFormRow(i, 'key', e.target.value)}
                placeholder="Key"
                className={`flex-1 bg-gray-700 rounded px-2 py-1 text-xs outline-none ${
                  row.enabled === false ? 'opacity-40 text-gray-500' : 'text-gray-100'
                }`}
              />
              <input
                value={row.value}
                onChange={(e) => updateFormRow(i, 'value', e.target.value)}
                placeholder="Value"
                className={`flex-1 bg-gray-700 rounded px-2 py-1 text-xs outline-none ${
                  row.enabled === false ? 'opacity-40 text-gray-500' : 'text-gray-100'
                }`}
              />
              <button
                onClick={() => removeFormRow(i)}
                className="text-red-500 hover:text-red-400 text-xs shrink-0"
              >
                ×
              </button>
            </div>
          ))}
          <button onClick={addFormRow} className="mt-2 text-xs text-blue-400 hover:text-blue-300">
            + Add Field
          </button>
        </div>
      )}
    </div>
  );
}
