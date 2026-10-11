# OneTap

**One card. Every purchase goes to the best credit card you already own.**

Tap once, and OneTap picks the card that earns you the most rewards. No memorizing, no guessing.

## Inspiration

We've all built financial apps before, and we kept running into the same small problem: picking the right credit card at checkout is harder than it should be.

Most people with more than one card just use the same one for everything and miss out on rewards. We wanted to remove that friction and build one simple card that anyone can use.

## What it does

- **Connect your cards.** Link your bank in a few taps, and OneTap finds your credit cards.
- **Tap one card.** At checkout, you tap your OneTap card like any other card.
- **Get the best rewards.** OneTap checks what you're buying (food, gas, groceries) and charges the card that earns the most for it.
- **See it instantly.** Your phone shows which card was used and what you earned, within about two seconds.

Prefer to choose yourself? Switch to Manual mode and pick the card.

## How we built it

- **Mobile app:** Expo and React Native with TypeScript
- **Backend:** Node.js, TypeScript and Express
- **Database:** Supabase
- **Bank connections:** Plaid
- **Card issuing and payments:** Stripe
- **Hardware:** an NFC card and a USB card reader, connected with Node.js
- **Store checkout screen:** React and Vite

## Challenges we ran into

- **Connecting hardware to software.** Getting a tap on a physical card reader to travel through our backend and show up on a phone took a lot of trial and error.
- **Splitting up the work.** With four people building different pieces at the same time, we had to agree early on how everything would connect so the parts fit together at the end.

## Accomplishments that we're proud of

We got real NFC cards and card readers working as a full transaction system. You tap a card, the purchase is routed to the best card, and the result shows up on your phone right away.

## What we learned

We learned how to work with Plaid, Stripe and Lithic, the financial technologies behind transactions all over the world. It was our first time working this close to how payments actually move.

## What's next for OneTap

- Publish the app on the App Store
- Grow to new users and support more credit cards

---

Want the full details? Read the product requirements in [onetapPRD.md](onetapPRD.md).
