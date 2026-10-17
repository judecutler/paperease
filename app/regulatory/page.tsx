import { redirect } from "next/navigation";

// The company-facing evidence workspace is now part of Regulatory watch.
// Keep /regulatory as a friendly entry point to the legislation view.
export default function Page() {
  redirect("/regulatory/watch");
}