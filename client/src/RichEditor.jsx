import React, { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import {
  Bold, Italic, List, ListOrdered, Code2, Quote, Undo2, Redo2,
  Link2, ImagePlus, Table2, Heading2, Minus
} from 'lucide-react';

export default function RichEditor({ value = '', onChange, onUpload, disabled = false }) {
  const uploadRef = useRef(onUpload);
  useEffect(() => { uploadRef.current = onUpload; }, [onUpload]);

  const editor = useEditor({
    editable: !disabled,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      Image.configure({ inline: false, allowBase64: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell
    ],
    content: value || '<p></p>',
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'kb-editor-content'
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files || [])];
        if (!files.length || !uploadRef.current) return false;
        event.preventDefault();
        void insertFiles(files);
        return true;
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false;
        const files = [...(event.dataTransfer?.files || [])];
        if (!files.length || !uploadRef.current) return false;
        event.preventDefault();
        void insertFiles(files);
        return true;
      }
    }
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = editor.getHTML();
    const next = value || '<p></p>';
    if (current !== next) editor.commands.setContent(next, false);
  }, [editor, value]);

  async function insertFiles(files) {
    if (!editor || !uploadRef.current) return;
    for (const file of files) {
      try {
        const asset = await uploadRef.current(file);
        if (!asset) continue;
        if (asset.media_type === 'IMAGE') {
          editor.chain().focus().setImage({ src: asset.url, alt: asset.original_name }).run();
        } else {
          const label = escapeHtml(asset.original_name || asset.name || 'Anexo');
          editor.chain().focus().insertContent(
            `<p><a href="${asset.url || '#'}" target="_blank" rel="noopener noreferrer">📎 ${label}</a></p>`
          ).run();
        }
      } catch (error) {
        console.error(error);
      }
    }
  }

  if (!editor) return <div className="editor-loading">Carregando editor…</div>;

  const askLink = () => {
    const previous = editor.getAttributes('link').href || '';
    const href = window.prompt('URL do link:', previous);
    if (href === null) return;
    if (!href.trim()) return editor.chain().focus().extendMarkRange('link').unsetLink().run();
    editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  };

  return (
    <div className={`rich-editor ${disabled ? 'is-disabled' : ''}`}>
      {!disabled && (
        <div className="editor-toolbar" role="toolbar" aria-label="Formatação">
          <Tool title="Título" active={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 /></Tool>
          <Tool title="Negrito" active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></Tool>
          <Tool title="Itálico" active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></Tool>
          <Tool title="Lista" active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></Tool>
          <Tool title="Lista numerada" active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></Tool>
          <Tool title="Bloco de código" active={editor.isActive('codeBlock')}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code2 /></Tool>
          <Tool title="Citação" active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote /></Tool>
          <Tool title="Link" active={editor.isActive('link')} onClick={askLink}><Link2 /></Tool>
          <Tool title="Tabela" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 /></Tool>
          <Tool title="Linha horizontal" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus /></Tool>
          <label className="editor-tool" title="Adicionar imagem ou arquivo">
            <ImagePlus />
            <input type="file" hidden multiple onChange={e => {
              const selected = [...e.target.files];
              e.target.value = '';
              void insertFiles(selected);
            }} />
          </label>
          <span className="editor-spacer" />
          <Tool title="Desfazer" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 /></Tool>
          <Tool title="Refazer" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 /></Tool>
        </div>
      )}
      <EditorContent editor={editor} />
      {!disabled && (
        <div className="editor-hint">
          Arraste arquivos para o editor ou cole prints com Ctrl+V. Imagens entram no conteúdo; outros arquivos entram na Central de Materiais.
        </div>
      )}
    </div>
  );
}

function Tool({ children, title, active = false, disabled = false, onClick }) {
  return (
    <button
      type="button"
      className={`editor-tool ${active ? 'active' : ''}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[c]);
}
