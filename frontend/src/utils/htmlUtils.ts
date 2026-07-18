import DOMPurify from 'dompurify';

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  // 如果不含HTML标签，视为纯文本，先将 \n 转换为 <br>
  const hasHtmlTag = /<[a-z][\s\S]*?>/i.test(html);
  if (!hasHtmlTag) {
    const escaped = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    return DOMPurify.sanitize(escaped, {
      ALLOWED_TAGS: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'img', 'span'],
      ALLOWED_ATTR: ['src', 'alt', 'class', 'style'],
    });
  }
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'img', 'span'],
    ALLOWED_ATTR: ['src', 'alt', 'class', 'style'],
  });
}

export function htmlToPlainText(html: string): string {
  if (!html) return '';
  const temp = document.createElement('div');
  temp.innerHTML = DOMPurify.sanitize(html);
  return temp.textContent || temp.innerText || '';
}

export async function uploadImagesFromHtml(html: string, type: 'content' | 'options' | 'explanation'): Promise<string> {
  const temp = document.createElement('div');
  temp.innerHTML = html;
  const imgs = temp.querySelectorAll('img');

  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    if (src.startsWith('data:')) {
      try {
        const matches = src.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches) {
          console.warn('无效的 data URL 格式');
          continue;
        }
        const mimeType = matches[1];
        const base64Data = matches[2];

        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const blob = new Blob([bytes], { type: mimeType });
        const formData = new FormData();
        formData.append('image', blob, 'pasted-image.png');

        const token = localStorage.getItem('xgpy_token');
        const uploadRes = await fetch(`/api/upload/question-image?type=${type}`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });
        const data = await uploadRes.json();
        if (data.data?.url) {
          img.setAttribute('src', data.data.url);
        } else {
          console.warn('图片上传返回错误:', data.error);
        }
      } catch (e) {
        console.error('图片上传失败:', e);
      }
    }
  }

  return temp.innerHTML;
}

export function plainTextToHtml(text: string): string {
  if (!text) return '';
  if (text.includes('<p>') || text.includes('<br>') || text.includes('<img')) {
    return text;
  }
  const lines = text.split('\n');
  if (lines.length === 0) return '<p></p>';
  return lines.map(line => {
    if (line.trim() === '') return '<p><br></p>';
    // 将前导空格转换为 &nbsp; 以保留缩进（ProseMirror 解析 HTML 时会规范化普通空格）
    const converted = line.replace(/^( +)/, (match) => '&nbsp;'.repeat(match.length));
    return `<p>${converted}</p>`;
  }).join('');
}
