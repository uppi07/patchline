import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { validateNewTicket } from '../utils/workflowRules';
import type { NewTicketInput, RepositoryConfig, TicketPriority } from '../types';

interface NewTicketModalProps {
  open: boolean;
  repositories: RepositoryConfig[];
  nextNumber: number;
  onClose: () => void;
  onCreateTicket: (input: NewTicketInput) => void;
}

export function NewTicketModal({
  open,
  repositories,
  nextNumber,
  onClose,
  onCreateTicket,
}: NewTicketModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [repo, setRepo] = useState(repositories[0]?.fullName || 'acme-corp/payments-api');
  const [priority, setPriority] = useState<TicketPriority>('High');
  const [acceptanceCriteriaText, setAcceptanceCriteriaText] = useState('');
  const [targetFilesText, setTargetFilesText] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof NewTicketInput, string>>>({});

  if (!open) return null;

  const suggestedKey = `ENG-${nextNumber}`;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const input: NewTicketInput = {
      key: suggestedKey,
      title,
      description,
      repo,
      priority,
      acceptanceCriteriaText,
      targetFilesText,
    };

    const result = validateNewTicket(input);
    if (!result.valid) {
      setErrors(result.errors);
      return;
    }

    onCreateTicket(input);
    setTitle('');
    setDescription('');
    setAcceptanceCriteriaText('');
    setTargetFilesText('');
    setErrors({});
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-ticket-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h2
              id="new-ticket-modal-title"
              className="text-base font-bold text-slate-900 dark:text-white"
            >
              Create Jira Ticket
            </h2>
            <p className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
              Key: {suggestedKey}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="new-ticket-title"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Summary Title
            </label>
            <input
              id="new-ticket-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Rate limit password reset requests per IP"
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
            />
            {errors.title && (
              <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{errors.title}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="new-ticket-repo"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Target Repository
              </label>
              <select
                id="new-ticket-repo"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
              >
                {repositories.map((r) => (
                  <option key={r.id} value={r.fullName}>
                    {r.fullName}
                  </option>
                ))}
              </select>
              {errors.repo && (
                <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{errors.repo}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="new-ticket-priority"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Priority
              </label>
              <select
                id="new-ticket-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="Urgent">Urgent</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="new-ticket-description"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Problem Description
            </label>
            <textarea
              id="new-ticket-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the engineering requirements and constraints..."
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
            />
            {errors.description && (
              <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                {errors.description}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="new-ticket-criteria"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Acceptance Criteria (one per line)
            </label>
            <textarea
              id="new-ticket-criteria"
              rows={3}
              value={acceptanceCriteriaText}
              onChange={(e) => setAcceptanceCriteriaText(e.target.value)}
              placeholder={'Return HTTP 429 after 5 failed attempts\nAdd unit test covering reset window'}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
            />
            {errors.acceptanceCriteriaText && (
              <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                {errors.acceptanceCriteriaText}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="new-ticket-files"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Target Files (optional, comma-separated)
            </label>
            <input
              id="new-ticket-files"
              type="text"
              value={targetFilesText}
              onChange={(e) => setTargetFilesText(e.target.value)}
              placeholder="src/middleware/rateLimit.ts, src/middleware/rateLimit.test.ts"
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-lg border border-slate-200 px-3.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-9 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Create Ticket
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
