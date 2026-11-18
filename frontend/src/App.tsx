import Header from "./components/Header";
import MapPage from "./pages/MapPage";

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <Header />
      <main className="relative flex-1">
        <MapPage />
      </main>
    </div>
  );
}
