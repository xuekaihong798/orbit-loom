import { createFileRoute } from "@tanstack/react-router";
import { OrbitField } from "@/components/orbit-field";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <OrbitField />;
}
