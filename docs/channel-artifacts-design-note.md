# Work lives alongside the conversation

We’re proposing a simple way to bring tasks and projects into Buzz: **they live
inside channels and threads, alongside the conversations about them.** The
conversation captures how people reached a decision; the task or project keeps
the current agreed state easy to find and update.

A channel is still a place for people to work together—not a project in disguise.
A team can keep several projects in one channel, or give a larger project its own
channel. A thread can contain several tasks. People don’t need to create a
project or repository before they can track a task.

## What this means for the experience

- **Add structure where work starts.** Turn an emerging piece of work into a
  task without replacing or relocating the conversation. Keep its outcome,
  status, and assignees alongside the discussion.
- **One record, several useful views.** A task can appear in a project overview
  and in its original conversation. These are views of the same task, not
  copies. Adding it to a project does not move it.
- **The home channel determines who can see it.** A task in a private channel
  stays private when linked from a broader project. A link does not invite
  people, reveal private details, or give access to its discussion. Threads
  share their channel’s audience; they are not separately private spaces.
- **Sharing follows the channel, not a separate task guest list.** Someone who
  cannot access the home channel cannot be given access to just that task. Give
  them access to the channel, or move the task to a channel they can access.
  A separately shared summary is not access to the original task.
- **Editing follows the channel’s permissions.** People allowed to contribute
  in the home channel can update the work; it is not locked to whoever created
  it. Moving requires permission to contribute in both places; deleting requires
  channel administration, except in a direct message where participants are
  peers and can delete shared work. In an open channel, people allowed to post can also
  update its work, even if they have not joined the channel.
- **Give growing work more room deliberately.** A task can move from a thread
  into a new channel and remain the same task. Before moving, show who will be
  able to see its current details. The old discussion stays where it was and
  keeps its original access; it is not automatically shared with the new group.
- **Keep progress distinct from conversation.** Changes should appear promptly
  wherever the work is shown, without making every status edit look like a new
  chat message or marking a conversation as read.
- **Finishing work does not close the room.** Completing a task or archiving a
  project leaves the channel and other work in it alone.

For example: a timeout bug is discussed in a team thread. Someone adds a task
there, then includes it in the reliability project. People can follow it from
either place if they have access to its home channel. If a contractor later
needs to collaborate, an authorized person can move the task’s current details
to a shared channel, deliberately selecting any context to bring along. The
private team discussion does not come with it.

## What we need to design

Make it clear **what the work is, where its main conversation is, who can see
it, and whether you are editing the existing record or creating another one**.
Design for several tasks or projects in one place—not a single special card.
Project overviews must handle work with different audiences without exposing
private information or implying everyone sees the same complete list.

The same approach should accommodate other kinds of shared records later.
Desktop and mobile should agree on familiar types, and show a useful basic
card when they encounter a type they do not yet support. People should not have
to configure plugins to get a coherent default experience.

We’re using “artifact” as a working umbrella term. In the product, prefer the
specific name—“task,” “project,” and so on—rather than making people learn it.
Code repositories and reviews keep their own access rules; connecting them to a
task must not imply that its audience can also see the code.
