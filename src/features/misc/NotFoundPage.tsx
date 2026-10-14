import { Link } from 'react-router-dom';
import { useDocumentTitle } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/layout-bits';

export default function NotFoundPage() {
  useDocumentTitle('Not found');
  return (
    <Card className="mx-auto max-w-lg">
      <EmptyState illustration="error" title="Page not found" description="The page you’re looking for doesn’t exist or has moved." action={<Button asChild><Link to="/dashboard">Back to dashboard</Link></Button>} />
    </Card>
  );
}
