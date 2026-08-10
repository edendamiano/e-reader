import { useEffect, useState, type DragEvent } from "react";
import type { LibraryBook, LibrarySort } from "../../../../packages/shared/src/types";

interface LibraryViewProps {
  books: LibraryBook[];
  query: string;
  sort: LibrarySort;
  notice: string;
  onQueryChange(value: string): void;
  onSortChange(value: LibrarySort): void;
  onImport(): void;
  onDropImport(files: File[]): Promise<void>;
  onOpen(bookId: string): void;
  onDelete(bookId: string): Promise<void>;
  onSettings(): void;
}

export function LibraryView(props: LibraryViewProps) {
  const [details, setDetails] = useState<LibraryBook>();
  const [deletePending, setDeletePending] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!details) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (deletePending) setDeletePending(false);
      else setDetails(undefined);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [details, deletePending]);

  const drop = async (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files).filter((file) => /\.(?:epub|azw3)$/i.test(file.name));
    if (files.length > 0) await props.onDropImport(files);
  };

  return (
    <main
      className={`library-shell${dragging ? " is-dragging" : ""}`}
      data-testid="bookshelf"
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={(event) => void drop(event)}
    >
      <header className="library-header">
        <h1>书架</h1>
        <div className="library-actions">
          <label className="search-field">
            <span className="sr-only">搜索书名</span>
            <input aria-label="搜索书名" type="search" value={props.query} placeholder="搜索书名" onChange={(event) => props.onQueryChange(event.target.value)} />
          </label>
          <select aria-label="排序" value={props.sort} onChange={(event) => props.onSortChange(event.target.value as LibrarySort)}>
            <option value="recent">最近阅读</option>
            <option value="title">书名</option>
          </select>
          <button type="button" onClick={props.onImport}>导入</button>
          <button type="button" className="quiet-button" onClick={props.onSettings}>设置</button>
        </div>
      </header>
      {props.notice && <div className="library-notice" role="status">{props.notice}</div>}
      {props.books.length === 0 ? (
        <section className="empty-library">
          <p>{props.query ? "没有匹配的书。" : "将 EPUB 或 AZW3 拖到这里"}</p>
          {!props.query && <span className="muted">或按 Ctrl+O</span>}
          {!props.query && <button type="button" onClick={props.onImport}>选择书籍</button>}
        </section>
      ) : (
        <section className="book-grid" aria-label="书架内容">
          {props.books.map((book) => (
            <article
              className="book-tile"
              key={book.id}
              tabIndex={0}
              data-testid="book-tile"
              onDoubleClick={() => props.onOpen(book.id)}
              onKeyDown={(event) => { if (event.key === "Enter") props.onOpen(book.id); }}
            >
              <div className="cover-wrap">
                <img src={book.coverDataUrl} alt="" draggable={false} />
                <button type="button" className="book-more" aria-label={`${book.title} 详情`} onClick={() => setDetails(book)}>···</button>
              </div>
              <h2>{book.title}</h2>
              <div className="book-progress" aria-label={`阅读进度 ${Math.round(book.progress * 100)}%`}><span style={{ width: `${Math.round(book.progress * 100)}%` }} /></div>
            </article>
          ))}
        </section>
      )}
      {dragging && <div className="drop-hint">松开以导入</div>}
      {details && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetails(undefined); }}>
          <section className="book-details" role="dialog" aria-modal="true" aria-label="书籍信息">
            <img src={details.coverDataUrl} alt="" />
            <div>
              <h2>{details.title}</h2>
              <p>{details.author}</p>
              <p className="muted">{details.format.toUpperCase()} · {details.sourceFilename}</p>
              <div className="dialog-actions">
                <button type="button" onClick={() => props.onOpen(details.id)}>阅读</button>
                <button type="button" className="danger-button" onClick={() => setDeletePending(true)}>删除</button>
                <button type="button" className="quiet-button" onClick={() => setDetails(undefined)}>关闭</button>
              </div>
            </div>
          </section>
        </div>
      )}
      {details && deletePending && (
        <div className="modal-backdrop confirm-layer" role="presentation">
          <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-label="确认删除">
            <p>从 Reader 书架删除《{details.title}》？原始文件不会被删除。</p>
            <div className="dialog-actions">
              <button type="button" className="danger-button" onClick={() => void props.onDelete(details.id).then(() => { setDeletePending(false); setDetails(undefined); })}>删除</button>
              <button type="button" className="quiet-button" onClick={() => setDeletePending(false)}>取消</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
