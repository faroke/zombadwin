import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface PlaceholderProps {
  title: string;
  milestone: string;
}

export function Placeholder({ title, milestone }: PlaceholderProps): JSX.Element {
  return (
    <div className="container mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>Planned for the next milestone — {milestone}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Not implemented yet.</p>
        </CardContent>
      </Card>
    </div>
  );
}
