import { Alert, Button, Skeleton } from "@heroui/react";

export function WorksheetFeedback({ request, subject }) {
  if (request.loading) {
    return (
      <div className="loading-lines monthly-loading" role="status" aria-label={`Loading ${subject}`}>
        <Skeleton /><Skeleton /><Skeleton />
      </div>
    );
  }
  if (!request.error) return null;
  return (
    <Alert status="danger" className="search-alert">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>Could not load {subject}. {request.error}</Alert.Description>
        <Button size="sm" variant="secondary" onPress={request.retry}>Retry</Button>
      </Alert.Content>
    </Alert>
  );
}
