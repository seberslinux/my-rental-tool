export function Spinner({ className = '' }: { className?: string }) {
  return <div className={`animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 ${className}`} />;
}

export function PageLoading() {
  return (
    <div className="flex items-center justify-center py-20">
      <Spinner />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-red-600 mb-3">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary text-sm">Try again</button>
      )}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
      {message}
    </div>
  );
}
