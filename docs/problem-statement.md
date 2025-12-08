## Elevator pitch

## General idea

The core idea behind the app is to tackle the quote "Slack, where critical information comes to die" by rethinking core of what a corporate chat application should be, by building a strong foundation of knowledge around your organization by using SLMs and LLMs (small and large language models). A secondary goal is to improve the user experience by a smarter notification system where urgency is factored in to the notification system.

To accomplish knowledge buildup, we'll build the app around the idea of GAM - General Agentic Memory (See https://arxiv.org/abs/2511.18423, General Agentic Memory Via Deep Research) combined with knowledge graphs. These two techniques are powerful on their own and should hopefully shine when put together. GAM helps with loss-less memory (i.e., perfect recall), and knowledge graphs help finding relevant or related information to the current conversation. Basically, the application will remember decisions, actions, events and other relevant information in order to help resurface it in various ways:

- Knowledge explorer for exploring information in a structured way using a knowledge graph of memos
- Agentic assistant accessible in chats or in standalone _Thinking Spaces_ for self-reflection and exploration
- Possible auto-answer on sent message without necessarily showing up as a reply to the message

Urgency-based notifications, while secondary, build upon the core knowledge system and language models being able to deduce urgency from the conversational context (or manual escalation). This aims at minimizing context switching for staff to check if the message is urgent.

## Target audience

The initial target audience is startups and scale-ups with an employee count all the way from 1 (e.g., solo founder) to 1000 (e.g., quite large, but not the size of Microsoft). Longer term I intend for this project to grow further and support mega corporations too, but we have to start somewhere. Covering 1-1000 still fits a pretty broad audience, all with different needs and levels of complexity.

By targeting single founders and small teams, we can get a foot in the door before tackling companies with existing systems which hopefully helps us with some example customers as they grow, potentially helping with _why they're successful_.

## The knowledge system

The knowledge system combines General Agentic Memory (GAM) and knowledge graphs to create a powerful foundation for the application, upon which we can build core features like actually useful search, automatic question answering, smart notifications, and more.

### GAM for multi-party chat

GAM's a fairly recent concept in the field of AI which has benchmarked highly on long running tasks with minimal context bloat. This is achieved using a two-part system broken into a memorizer agent and a deep researcher agent. The memorizer inspects and highlights high-value information and stores them as memos (simple summaries of important information), linking to the original sources. The deep researcher helps retrieve relevant memos and what they call pages (conversational chunks) from storage.

For this to work in a multi-party chat, the memorizer agent cannot run on all messages since how you talk with an LLM is generally different from how you talk with a team. In LLM chats like ChatGPT or Claude.ai, users typically either work explicitly create new conversations for new topics, or continue in a singular mega discussion, but always with some form of intent to understand more about something, basically there's often a clear scope to the conversation. This is now how team chat works, as there's a myriad of types of conversations happening where a lot of discussions are not worth memorizing. Human-to-human chat is often less intentional, often with less context than is supplied in ChatGPT or similar because members of teams _have_ external storage (brains).

To tackle this, the system will run cheap models on all messages in their context, attempting to extract conversational boundaries that the memorizer can work with. Then when the agent is invoked, it uses the deep researcher to retrieve relevant memos and pages from storage.

### Extracting conversational boundaries in real-time, async conversations

Chat is an inherently async medium often used in real-time. This means conversations cannot be split temporally. Chat is typically also not sequential, as in one chain of messages between two people with clear, well defined boundaries.

One answer to this has been threads in Slack, where it's possible to branch out a sub-discussion from a message sent in the main channel. An easy, but sometimes false assumption is that threads can be seen as isolated conversations. My experience tells me this is incorrect as some less technically apt team members will answer out-of-thread, and conversations may be _moved_ into a thread after certain time, looking something like:

```
[10:00] - A: Hey, I'm looking into this ticket: LIN-41231
[10:01] - B: Let me know if you need any help!
[10:02] - A: Thanks, do you know the cause of it?
[10:03]    - B (Thread from [10:02]): It's been like this forever, probably time to fix it. Heres why...
[10:04]    - A (Thread from [10:02]): Ah, OK. Should I do X?
[10:05] - C (not in thread): Oops, I was also looking into this, I found this. <explanation>
[10:06]     - A (Thread from [10:02]): C mentioned this [link to C]
[10:07]     - B (Thread from [10:02]): That's an interesting angle, I think that's probably the right approach.
[16:30]     - A (Thread from [10:02]): I fixed it here: <github link>.
```

Which in the channel would look like:

```
[10:00] - A: Hey, I'm looking into this ticket: LIN-41231
[10:01] - B: Let me know if you need any help!
[10:02] - A: Thanks, do you know the cause of it?
          (5 messages in thread)
[10:05] - C (not in thread): Oops, I was also looking into this, I found this. <explanation>
```

This is all the same conversation, and would also be highly likely to have other messages surrounding it in the channel.

I think we can handle this better than the incumbents by continuously monitoring messages around the current messages and applying conversational boundaries to them.

### Smart notifications

TODO: Add smart notifications section

## Core messaging platform

While the USP of this app will be the knowledge system, we need a robust messaging platform underneath it all. This means we need to support the standard stuff that is now expected to work:

- Multi-workspace support from the get-go (e.g., users can be a member of their job's workspace and their personal workspace)
- Private and public channels
- Direct messages between two or more users
- Scratchpad (basically the same as self-DMs)
- Multi-level threading, where a nested threads are supported out of the box. Not reddit-like, but Slack-like threading but deeper.
- Thinking Spaces which are essentially the same as chats in ChatGPT or Claude.ai
- Mentions, @username, #channel, @sorry (basically same as @all)
- Image, video, audio, and file sharing
  - As much as possible, AI agents should be able to process these as context for the conversation.
- Rich text formatting like Linear, Notion etc.
- Push notifications
- Search (full-text, vector search, from:@user, with:@user, in:#channel, in:@user (for DMs), is:thread (thread or channel), between:YYYY-MM-DD HH:MM:SS and YYYY-MM-DD HH:MM:SS)

In addition to the messaging platform, because we have this deep understanding of the organization using the system, we can build some useful AI features on top of it.

- @Ariadne agent which can be invoked or chatted with, which has a curated, default persona
- Agent personas, where users can create and customize their own agent personas to tag and chat with in Thinking Spaces. These can be used either for controlling the agent's behavior in Thinking Spaces or chats, such as a customer persona, internal support persona, etc.
  - Model picker
  - Custom instructions/prompt
  - Extra context (e.g., uploaded files, etc.)
  - Custom tool selection (e.g., disable certain tools, provide others, MCP?)

General SaaS stuff:

- Authentication: WorkOS, their pricing is very generous with the first one million users being free.
- Payments: Stripe
- Pricing model: free -> pro -> max -> enterprise?
  - Free: basic features, unlimited messages for a handful of users (5 or 10 seats?), no AI features. Can be upgraded to include AI features at a higher rate than on the pro plan (Should be cheaper to have free + 1 seat than Pro, but Pro should quickly become more cost effective)
  - Pro: all features, unlimited messages, handful of users included (10 seats?), AI features with a quota per seat and ability to buy more? Base features should be accounted for within the pro plan, where we cut off extra usage after a certain amount. E.g., embeddings, knowledge buildup etc continues working, but agents and thinking spaces stop working after hitting the quota.
  - Max: same as pro, more seats, more AI usage included. Should be cheaper at high AI usage than Pro, but with a more expensive base plan.

### The messaging platform

The core application is an important piece to get right. Simple yet powerful is the goal.

Everything that can send messages is a stream. That way we're able to re-use logic for all things messaging.

Streams are a continuous stream of events, which may contain messages, reactions, mentions, etc. They always scoped to a workspace, have their own unique ID, a type, display name, and a set of members.

Channels:
- Type: channel
- Display name: Slug as display name and human-readable identifier. Slugs are unique within a workspace, can be changed
- Membership: public or private, private requires a member invites other users, public is open to anyone in the workspace
- Description: Optional description of the channel

Threads:
- Type: thread
- Display name: Auto generated by cheap model after context has become somewhat clear (displayed as "#general>today's lunch options")
- Membership: requires membership of one of the parent channels, auto-join on first message or "watch thread" button
- Description: Optional description of the thread
- Side note: threads are virtual until the first message is sent, after which they become real streams.

Direct messages:
- Type: direct message
- Display name: Virtual display name for the direct messages -> the name of the _other_ member
- Membership: always exactly two members
- Side note: direct messages are virtual until the first message is sent, after which they become real streams.

Scratchpad:
- Type: scratchpad
- Display name: Defaults to Scratchpad but can be renamed by the user
- Membership: always exactly one member - the user themselves.
- Description: Optional description of the scratchpad
- Side note: scratchpads are virtual until the first message is sent, after which they become real streams.

Thinking Spaces:
- Type: thinking space
- Display name: Auto generated by cheap model a la Claude.ai, ChatGPT etc
- Membership: defaults to one member but can be shared with others.
- Description: Optional description of the thinking space
- Side note: thinking spaces are virtual until the first message is sent, after which they become real streams.

Streams have the following database tables:
- stream: the actual stream entity
- stream_members: the members of the stream
- stream_events: basically a set items displayed in the view of the stream, such as messages, membership changes (join, leave), AI agent actions (processing, processing done)
  - Note: agents sends messages on the stream exactly like any other member.
  - Note: stream events typically don't have their own content, rather point to another entity, like a message