interface LoadingBarProps {
  progress: number;
  label?: string;
}

export function LoadingBar({ progress, label }: LoadingBarProps) {
  return (
    <div className="w-full">
      {label && <p className="text-sm text-gray-400 mb-1">{label}</p>}
      <div className="w-full bg-gray-700 rounded-full h-2">
        <div
          className="bg-green-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${Math.min(100, progress)}%` }}
        />
      </div>
    </div>
  );
}
