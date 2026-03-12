import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

export default function ProductsLoading() {
  return (
    <div className="flex items-center justify-center py-20">
      <LoadingSpinner />
    </div>
  );
}
