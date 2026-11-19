import { useParams } from "react-router";
import LiveViewer from "../components/LiveViewer";
import { getTrack, getWatch } from "../lib/api";

/** /track/:token — a one-off trip link for people who aren't saved contacts. */
export default function TrackPage() {
  const { token = "" } = useParams();
  return <LiveViewer key={token} kind="track" token={token} load={getTrack} />;
}

/** /watch/:token — a trusted contact's personal, secret watch page. */
export function WatchPage() {
  const { token = "" } = useParams();
  return <LiveViewer key={token} kind="watch" token={token} load={getWatch} />;
}
