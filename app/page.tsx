import Dashboard from "@/components/dashboard";
import { connection } from "next/server";

export default async function HomePage() {
  await connection();
  return <Dashboard />;
}
