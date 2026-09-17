import { useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import { ScopeSelect, type ScopeSelection } from '../../components/scope-select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'

export type DocumentScope = {
  fundId: string
  portcoId?: string | null
}

type DocumentListProps = {
  scope: DocumentScope
}

type DocumentImportProps = {
  scope: DocumentScope
}

const documentQueryKey = (scope: DocumentScope) => [
  'documents',
  scope.fundId,
  scope.portcoId ?? null,
]

async function fetchDocuments(scope: DocumentScope) {
  const response = await api.documents.$get({
    query: {
      fundId: scope.fundId,
      ...(scope.portcoId ? { portcoId: scope.portcoId } : {}),
    },
  })

  if (!response.ok) {
    throw new Error(`Could not load documents (status ${response.status}).`)
  }

  return response.json()
}

type DocumentListItem = Awaited<ReturnType<typeof fetchDocuments>>['data'][number]

function isInFlight(status: DocumentListItem['status']) {
  return status === 'queued' || status === 'processing'
}

function stripMarkdownFrontmatter(content: string) {
  return content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}

async function fetchDocument(documentId: string, scope: DocumentScope) {
  const response = await api.documents[':documentId'].$get({
    param: { documentId },
    query: { fundId: scope.fundId, portcoId: scope.portcoId || undefined },
  })
  if (!response.ok) throw new Error(`Could not load document (status ${response.status}).`)
  return response.json()
}

/** Lists the documents in a fund-wide or portfolio-company scope. */
export function DocumentList({ scope }: DocumentListProps) {
  const [selectedDocument, setSelectedDocument] = useState<DocumentListItem | null>(null)
  const documents = useQuery({
    queryKey: documentQueryKey(scope),
    queryFn: () => fetchDocuments(scope),
    // Keep checking while the pipeline still has queued or processing documents.
    refetchInterval: (query) =>
      query.state.data?.data.some((document) => isInFlight(document.status)) ? 3000 : false,
  })

  if (documents.isPending)
    return <p className="mt-16 border-t border-rule py-5 text-muted">Loading documents…</p>
  if (documents.isError)
    return <p className="mt-16 border-t border-rule py-5 text-failure">{documents.error.message}</p>

  if (documents.data.data.length === 0) {
    return (
      <p className="border-t border-rule py-5 text-[0.92rem] text-muted">
        No documents have been imported into this scope.
      </p>
    )
  }

  return (
    <>
      <div className="overflow-x-auto border-t border-rule">
        <table className="min-w-[620px] w-full border-collapse text-left">
          <thead>
            <tr>
              <th
                className="border-b border-rule py-3 pr-4 text-[0.73rem] font-semibold uppercase tracking-[0.03em] text-muted"
                scope="col"
              >
                Document
              </th>
              <th
                className="border-b border-rule py-3 pr-4 text-[0.73rem] font-semibold uppercase tracking-[0.03em] text-muted"
                scope="col"
              >
                Scope
              </th>
              <th
                className="border-b border-rule py-3 pr-4 text-[0.73rem] font-semibold uppercase tracking-[0.03em] text-muted"
                scope="col"
              >
                Imported
              </th>
              <th
                className="border-b border-rule py-3 pr-0 text-[0.73rem] font-semibold uppercase tracking-[0.03em] text-muted"
                scope="col"
              >
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {documents.data.data.map((document) => (
              <tr key={document.id}>
                <td className="border-b border-rule py-4 pr-4 text-[0.84rem] text-muted">
                  <button
                    type="button"
                    className="block cursor-pointer text-left font-serif text-[1.05rem] font-normal text-ink underline decoration-rule underline-offset-4 hover:text-accent"
                    onClick={() => setSelectedDocument(document)}
                  >
                    {document.title}
                  </button>
                  <small className="mt-[3px] block">{document.filename}</small>
                </td>
                <td className="border-b border-rule py-4 pr-4 text-[0.84rem] text-muted">
                  {document.portcoId ? 'Portfolio company' : 'Fund-wide'}
                </td>
                <td className="border-b border-rule py-4 pr-4 text-[0.84rem] text-muted">
                  {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                    new Date(document.createdAt)
                  )}
                </td>
                <td className="border-b border-rule py-4 pr-0 text-[0.84rem] text-muted">
                  <span
                    className={cn(
                      'text-[0.76rem] capitalize',
                      document.status === 'ready' && 'text-accent',
                      document.status === 'failed' && 'text-failure'
                    )}
                  >
                    {document.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedDocument ? (
        <DocumentViewer
          document={selectedDocument}
          scope={scope}
          onClose={() => setSelectedDocument(null)}
        />
      ) : null}
    </>
  )
}

/** Opens a document in a dialog. Filename and status are read from the document when not supplied. */
export function DocumentViewer({
  document,
  scope,
  onClose,
}: {
  document: Pick<DocumentListItem, 'id' | 'title'> &
    Partial<Pick<DocumentListItem, 'filename' | 'status'>>
  scope: DocumentScope
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const detail = useQuery({
    queryKey: ['document', document.id, scope.fundId, scope.portcoId ?? null],
    queryFn: () => fetchDocument(document.id, scope),
  })
  const deleteDocument = useMutation({
    mutationFn: async () => {
      const response = await api.documents[':documentId'].$delete({
        param: { documentId: document.id },
        query: { fundId: scope.fundId, portcoId: scope.portcoId || undefined },
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        const message =
          body && 'error' in body
            ? body.error
            : `Could not delete document (status ${response.status}).`
        throw new Error(message)
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['documents', scope.fundId] })
      queryClient.removeQueries({ queryKey: ['document', document.id] })
      setConfirmOpen(false)
      onClose()
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="h-[min(900px,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)]! overflow-hidden rounded-none! border-rule! bg-paper! text-ink sm:max-w-5xl! grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle className="font-serif text-[1.7rem] font-normal tracking-[-0.03em]">
            {document.title}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap gap-x-3 gap-y-1 text-[0.78rem] text-muted">
            <span>{document.filename ?? detail.data?.data.filename}</span>
            <span className="capitalize">{document.status ?? detail.data?.data.status}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain border-t border-rule pt-5 pr-2">
          {detail.isPending ? <p className="text-muted">Loading document…</p> : null}
          {detail.isError ? <p className="text-failure">{detail.error.message}</p> : null}
          {detail.data ? (
            detail.data.data.mimeType === 'text/markdown' ? (
              <article className="mx-auto max-w-[800px] space-y-4 text-[0.96rem] leading-[1.7] text-ink">
                <ReactMarkdown
                  components={{
                    h1: ({ children }) => (
                      <h1 className="font-serif text-3xl font-normal">{children}</h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="font-serif text-2xl font-normal">{children}</h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="font-serif text-xl font-normal">{children}</h3>
                    ),
                    a: ({ children, href }) => (
                      <a className="text-accent underline" href={href}>
                        {children}
                      </a>
                    ),
                    ul: ({ children }) => <ul className="list-disc pl-6">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-6">{children}</ol>,
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-2 border-accent pl-4 text-muted">
                        {children}
                      </blockquote>
                    ),
                  }}
                >
                  {stripMarkdownFrontmatter(detail.data.data.content)}
                </ReactMarkdown>
              </article>
            ) : (
              <pre className="mx-auto max-w-[800px] whitespace-pre-wrap font-sans text-[0.96rem] leading-[1.7] text-ink">
                {detail.data.data.content}
              </pre>
            )
          ) : null}
        </div>
        <div className="flex justify-end border-t border-rule pt-4">
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="cursor-pointer text-[0.78rem] text-failure underline underline-offset-4"
              >
                Delete document
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-none border-rule bg-paper text-ink">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-serif text-xl font-normal">
                  Delete “{document.title}”?
                </AlertDialogTitle>
                <AlertDialogDescription className="leading-[1.5] text-muted">
                  This removes the source document and its processed chunks. This action cannot be
                  undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {deleteDocument.isError ? (
                <p className="text-sm text-failure">{deleteDocument.error.message}</p>
              ) : null}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteDocument.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(event) => {
                    event.preventDefault()
                    deleteDocument.mutate()
                  }}
                  disabled={deleteDocument.isPending}
                >
                  {deleteDocument.isPending ? 'Deleting…' : 'Delete document'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Imports a text or Markdown document, keeping the selected scope explicit. */
export function DocumentImport({ scope }: DocumentImportProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [targetScope, setTargetScope] = useState<DocumentScope>(scope)

  const importDocument = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a document before importing.')

      const response = await api.documents.$post({
        form: {
          file,
          fundId: targetScope.fundId,
          ...(targetScope.portcoId ? { portcoId: targetScope.portcoId } : {}),
          ...(title.trim() ? { title: title.trim() } : {}),
        },
      })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        const message =
          body && 'error' in body ? body.error : `Import failed (status ${response.status}).`
        throw new Error(message)
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['documents', scope.fundId] })
      setFile(null)
      setTitle('')
      setTargetScope(scope)
      setOpen(false)
    },
  })

  function chooseFile(candidate: File | undefined) {
    if (!candidate) return
    setFile(candidate)
    importDocument.reset()
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    chooseFile(event.dataTransfer.files[0])
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="cursor-pointer border border-accent bg-accent px-3 py-[9px] text-[0.84rem] text-white"
        >
          Import document
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-[570px] rounded-none! border-rule! bg-paper! text-ink">
        <DialogHeader>
          <DialogTitle className="font-serif text-[1.7rem] font-normal tracking-[-0.03em]">
            Import a document
          </DialogTitle>
          <DialogDescription className="leading-[1.5] text-muted">
            Add Markdown or plain text to the evidence available in this scope.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            importDocument.mutate()
          }}
        >
          {scope.portcoId ? (
            <p className="border-l-2 border-accent pl-2.5 text-[0.84rem] leading-[1.5] text-muted">
              This import stays within the current portfolio company.
            </p>
          ) : (
            <ScopeSelect
              fundId={scope.fundId}
              portcoId={targetScope.portcoId}
              onScopeChange={(selection: ScopeSelection) =>
                setTargetScope({ fundId: scope.fundId, portcoId: selection.portcoId })
              }
              disabled={importDocument.isPending}
            />
          )}
          <label className="grid gap-[7px]">
            <span className="text-[0.82rem] font-semibold">
              Title <em className="text-[0.75rem] font-normal not-italic text-muted">optional</em>
            </span>
            <input
              className="rounded-none border border-rule bg-card p-[10px_11px] font-[inherit] text-ink"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={file?.name ?? 'Use the filename'}
              disabled={importDocument.isPending}
            />
          </label>
          <label
            className="grid min-h-[154px] cursor-pointer place-items-center border border-dashed border-muted p-5 text-center text-muted hover:border-accent hover:text-accent"
            htmlFor="document-file"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <input
              className="sr-only"
              id="document-file"
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              onChange={(event) => chooseFile(event.target.files?.[0])}
              disabled={importDocument.isPending}
            />
            <strong className="font-serif text-[1.25rem] font-normal text-ink">
              {file ? file.name : 'Drop a document here'}
            </strong>
            <span className="text-[0.78rem]">
              {file
                ? `${Math.ceil(file.size / 1024)} KB · choose another file`
                : 'or choose a file · Markdown or text · up to 5 MB'}
            </span>
          </label>
          {importDocument.isError ? (
            <p className="-mt-1 text-[0.84rem] text-failure">{importDocument.error.message}</p>
          ) : null}
          <div className="flex justify-end">
            <button
              type="submit"
              className="cursor-pointer border border-accent bg-accent px-3 py-[9px] text-[0.84rem] text-white disabled:cursor-wait disabled:opacity-55"
              disabled={!file || importDocument.isPending}
            >
              {importDocument.isPending ? 'Importing…' : 'Import document'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
