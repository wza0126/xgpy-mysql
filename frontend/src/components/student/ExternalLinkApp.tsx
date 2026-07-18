import React from 'react';

interface ExternalLinkAppProps {
  url: string;
  title: string;
  useIframe?: boolean;
  onClose: () => void;
}

export const ExternalLinkApp: React.FC<ExternalLinkAppProps> = ({ url, title, useIframe, onClose }) => {
  if (useIframe) {
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="p-2 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <iframe
            src={url}
            title={title}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        </div>
      </div>
    );
  }

  // 直接在新标签页打开
  React.useEffect(() => {
    window.open(url, '_blank');
    onClose();
  }, [url, onClose]);

  return (
    <div className="flex items-center justify-center h-full bg-white">
      <div className="text-center">
        <div className="text-4xl mb-4">🌐</div>
        <p className="text-gray-600">正在打开 {title}...</p>
      </div>
    </div>
  );
};
