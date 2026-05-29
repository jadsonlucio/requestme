import { useState } from 'react';
import Sidebar from './components/Sidebar/Sidebar';
import RequestEditor from './components/RequestEditor/RequestEditor';
import ResponsePanel from './components/ResponsePanel/ResponsePanel';

export default function App() {
  const [response, setResponse] = useState(null);
  const [isSending, setIsSending] = useState(false);

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 overflow-hidden font-mono text-sm">
      <Sidebar />
      <div className="flex flex-1 overflow-hidden divide-x divide-gray-700">
        <RequestEditor onResponse={setResponse} isSending={isSending} setIsSending={setIsSending} />
        <ResponsePanel response={response} isSending={isSending} />
      </div>
    </div>
  );
}
