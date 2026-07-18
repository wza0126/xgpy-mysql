import React from 'react';

interface HtmlPageAppProps {
  htmlContent: string;
  title: string;
  onClose: () => void;
}

export const HtmlPageApp: React.FC<HtmlPageAppProps> = ({ htmlContent, title, onClose }) => {
  console.log('HtmlPageApp - Rendering with content:', htmlContent);

  return (
    <div className="h-full bg-white">
      <iframe
        title={title}
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms"
        srcDoc={htmlContent}
      />
    </div>
  );
};
