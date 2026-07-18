import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { uploadImagesFromHtml } from '../../utils/htmlUtils';
import './RichTextEditor.css';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  imageType?: 'content' | 'options' | 'explanation';
  minHeight?: string;
  editable?: boolean;
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  placeholder = '请输入内容...',
  imageType = 'content',
  minHeight = '120px',
  editable = true,
}) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'rich-text-image',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: value || '',
    editable,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || '', false);
    }
  }, [value, editor]);

  useEffect(() => {
    if (!editor) return;

    const dom = editor.view.dom;

    const onPaste = async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      let hasImage = false;
      const imageFiles: File[] = [];

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            imageFiles.push(file);
            hasImage = true;
          }
        }
      }

      if (hasImage) {
        event.preventDefault();
        for (const file of imageFiles) {
          await handleImageUpload(file);
        }
        return;
      }

      setTimeout(async () => {
        const currentHtml = editor.getHTML();
        const cleanedHtml = await uploadImagesFromHtml(currentHtml, imageType);
        if (cleanedHtml !== currentHtml) {
          editor.commands.setContent(cleanedHtml);
        }
      }, 100);
    };

    dom.addEventListener('paste', onPaste);
    return () => dom.removeEventListener('paste', onPaste);
  }, [editor, imageType]);

  const handleImageUpload = async (file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    
    const token = localStorage.getItem('xgpy_token');
    const res = await fetch(`/api/upload/question-image?type=${imageType}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    
    const data = await res.json();
    if (data.data?.url) {
      editor?.chain().focus().setImage({ src: data.data.url }).run();
    } else {
      alert('图片上传失败：' + (data.error || '未知错误'));
    }
  };

  const addImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) {
        await handleImageUpload(file);
      }
    };
    input.click();
  };

  if (!editable && !value) {
    return <div className="text-gray-400 text-sm">暂无内容</div>;
  }

  return (
    <div className="rich-text-editor-wrapper">
      {editable && (
        <div className="rich-text-toolbar">
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBold().run()}
            className={`toolbar-btn ${editor?.isActive('bold') ? 'is-active' : ''}`}
            title="加粗"
          >
            <i className="fa fa-bold"></i>
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            className={`toolbar-btn ${editor?.isActive('italic') ? 'is-active' : ''}`}
            title="斜体"
          >
            <i className="fa fa-italic"></i>
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            className={`toolbar-btn ${editor?.isActive('underline') ? 'is-active' : ''}`}
            title="下划线"
          >
            <i className="fa fa-underline"></i>
          </button>
          <span className="toolbar-divider"></span>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            className={`toolbar-btn ${editor?.isActive('bulletList') ? 'is-active' : ''}`}
            title="无序列表"
          >
            <i className="fa fa-list-ul"></i>
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            className={`toolbar-btn ${editor?.isActive('orderedList') ? 'is-active' : ''}`}
            title="有序列表"
          >
            <i className="fa fa-list-ol"></i>
          </button>
          <span className="toolbar-divider"></span>
          <button
            type="button"
            onClick={addImage}
            className="toolbar-btn"
            title="插入图片"
          >
            <i className="fa fa-image"></i>
          </button>
          <span className="toolbar-divider"></span>
          <button
            type="button"
            onClick={() => editor?.chain().focus().undo().run()}
            disabled={!editor?.can().undo()}
            className="toolbar-btn"
            title="撤销"
          >
            <i className="fa fa-undo"></i>
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().redo().run()}
            disabled={!editor?.can().redo()}
            className="toolbar-btn"
            title="重做"
          >
            <i className="fa fa-redo"></i>
          </button>
        </div>
      )}
      <div
        className="rich-text-content"
        style={{ minHeight }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};
