export default function HeadersTab({ headers, onChange }) {
  function addHeader() {
    onChange([...headers, { key: '', value: '', enabled: true }]);
  }

  function updateHeader(index, field, value) {
    const updated = headers.map((h, i) => (i === index ? { ...h, [field]: value } : h));
    onChange(updated);
  }

  function removeHeader(index) {
    onChange(headers.filter((_, i) => i !== index));
  }

  function toggleHeader(index) {
    updateHeader(index, 'enabled', !headers[index].enabled);
  }

  return (
    <div className="space-y-1">
      {headers.map((header, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={header.enabled !== false}
            onChange={() => toggleHeader(i)}
            className="accent-blue-500"
          />
          <input
            value={header.key}
            onChange={(e) => updateHeader(i, 'key', e.target.value)}
            placeholder="Header name"
            className={`flex-1 bg-gray-700 rounded px-2 py-1 text-xs outline-none ${
              header.enabled === false ? 'opacity-40' : 'text-gray-100'
            }`}
          />
          <input
            value={header.value}
            onChange={(e) => updateHeader(i, 'value', e.target.value)}
            placeholder="Value"
            className={`flex-1 bg-gray-700 rounded px-2 py-1 text-xs outline-none ${
              header.enabled === false ? 'opacity-40' : 'text-gray-100'
            }`}
          />
          <button
            onClick={() => removeHeader(i)}
            className="text-red-500 hover:text-red-400 text-xs shrink-0"
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={addHeader}
        className="mt-2 text-xs text-blue-400 hover:text-blue-300"
      >
        + Add Header
      </button>
    </div>
  );
}
