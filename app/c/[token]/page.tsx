import { Board } from "../../components/Board";

/**
 * A live share link: `/c/<token>`.
 *
 * The token is only handed to the client, which looks the chart up with the
 * publishable key like any other read. Nothing is fetched here, so the chart
 * never passes through the server and the page stays static.
 */
export default async function SharedChart({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Board shareToken={token} />;
}
