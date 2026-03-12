export function LoadingSpinner({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <div
      className={`border-2 border-hive-500 border-t-transparent rounded-full animate-spin ${className}`}
    />
  );
}
