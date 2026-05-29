const AUTH_TYPES = ['none', 'bearer', 'basic', 'apikey'];

export default function AuthTab({ authType, authConfig, onChangeType, onChangeConfig }) {
  function handleConfigField(field, value) {
    onChangeConfig({ ...authConfig, [field]: value });
  }

  return (
    <div>
      <div className="flex gap-1 mb-4">
        {AUTH_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => onChangeType(t)}
            className={`px-2 py-0.5 text-xs rounded ${
              authType === t ? 'bg-gray-600 text-gray-100' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {authType === 'none' && (
        <p className="text-gray-600 text-xs">No authentication.</p>
      )}

      {authType === 'bearer' && (
        <div>
          <label className="block text-xs text-gray-400 mb-1">Token</label>
          <input
            value={authConfig.token || ''}
            onChange={(e) => handleConfigField('token', e.target.value)}
            placeholder="Bearer token"
            className="w-full bg-gray-700 text-gray-100 rounded px-3 py-1.5 text-xs outline-none"
          />
          <p className="mt-1 text-gray-600 text-xs">Adds: Authorization: Bearer &lt;token&gt;</p>
        </div>
      )}

      {authType === 'basic' && (
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Username</label>
            <input
              value={authConfig.username || ''}
              onChange={(e) => handleConfigField('username', e.target.value)}
              placeholder="username"
              className="w-full bg-gray-700 text-gray-100 rounded px-3 py-1.5 text-xs outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Password</label>
            <input
              type="password"
              value={authConfig.password || ''}
              onChange={(e) => handleConfigField('password', e.target.value)}
              placeholder="password"
              className="w-full bg-gray-700 text-gray-100 rounded px-3 py-1.5 text-xs outline-none"
            />
          </div>
          <p className="text-gray-600 text-xs">Adds: Authorization: Basic &lt;base64&gt;</p>
        </div>
      )}

      {authType === 'apikey' && (
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Key</label>
            <input
              value={authConfig.key || ''}
              onChange={(e) => handleConfigField('key', e.target.value)}
              placeholder="X-API-Key"
              className="w-full bg-gray-700 text-gray-100 rounded px-3 py-1.5 text-xs outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Value</label>
            <input
              value={authConfig.value || ''}
              onChange={(e) => handleConfigField('value', e.target.value)}
              placeholder="api-key-value"
              className="w-full bg-gray-700 text-gray-100 rounded px-3 py-1.5 text-xs outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Add to</label>
            <div className="flex gap-3">
              {['header', 'query'].map((loc) => (
                <label key={loc} className="flex items-center gap-1 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="radio"
                    name="apikey-in"
                    value={loc}
                    checked={(authConfig.in || 'header') === loc}
                    onChange={() => handleConfigField('in', loc)}
                    className="accent-blue-500"
                  />
                  {loc === 'header' ? 'Header' : 'Query param'}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
