import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listChats } from "@/lib/db";
import { Chat } from "@/components/Chat";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Anyone who signs in with Google can use the app — no approval gate.
  const chats = listChats(session.user.id);
  return (
    <Chat
      user={{
        name: session.user.name ?? session.user.email ?? "You",
        email: session.user.email ?? "",
        image: session.user.image ?? null,
      }}
      initialChats={chats.map((c) => ({ id: c.id, title: c.title }))}
    />
  );
}
