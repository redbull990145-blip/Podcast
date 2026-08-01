"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SubscribeButton({
  podcastId,
  feedUrl,
  initiallySubscribed,
  /**
   * Set on the show page's tinted header, which is dark in both themes — so the
   * button cannot take its colours from the palette the way it does everywhere
   * else without becoming a dark button on a dark ground.
   */
  onDark = false,
}: {
  podcastId: string;
  feedUrl: string;
  initiallySubscribed: boolean;
  onDark?: boolean;
}) {
  const router = useRouter();
  const [subscribed, setSubscribed] = useState(initiallySubscribed);
  const [busy, setBusy] = useState(false);
  const [hovering, setHovering] = useState(false);

  async function toggle() {
    setBusy(true);
    // Optimistic: the button is the only thing that changes, and a failure
    // reverts it — waiting on the round-trip makes it feel sluggish.
    const next = !subscribed;
    setSubscribed(next);

    try {
      const res = next
        ? await fetch("/api/subscriptions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ feedUrl }),
          })
        : await fetch(`/api/subscriptions?podcastId=${podcastId}`, {
            method: "DELETE",
          });

      if (!res.ok) {
        setSubscribed(!next);
        return;
      }
      router.refresh();
    } catch {
      setSubscribed(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      onClick={toggle}
      disabled={busy}
      variant={subscribed ? "secondary" : "primary"}
      className={
        onDark
          ? subscribed
            ? "border-white/30 bg-transparent text-white hover:border-white/50 hover:bg-white/10"
            : "bg-[#f8f6f1] text-[#1c1b17] hover:bg-white"
          : undefined
      }
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : subscribed ? (
        <Check className="size-4" />
      ) : (
        <Plus className="size-4" />
      )}
      {/* Swapping the label on hover makes the destructive action explicit
          instead of leaving people to guess what clicking "Following" does. */}
      {subscribed ? (hovering && !busy ? "Unfollow" : "Following") : "Follow"}
    </Button>
  );
}
