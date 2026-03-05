import RegionCard from './RegionCard';
import type { RegionProbability } from '@/types';

interface Props {
  regions: RegionProbability[];
}

export default function RegionGrid({ regions }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {regions
        .sort(
          (a, b) =>
            (b.probability?.probability_score ?? 0) -
            (a.probability?.probability_score ?? 0)
        )
        .map((region) => (
          <RegionCard key={region.slug} region={region} />
        ))}
    </div>
  );
}
