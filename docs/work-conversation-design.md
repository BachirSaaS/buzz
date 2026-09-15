
| |Bradley | Taylor |
|---|---|---|
| Task home | Thread in a project or repo channel. | Project/repo thread or standalone task channel. Tasks from outside a project can be linked into a project. |
| Branch discussion | Can share the task thread. | Repo thread linked to the task. |
| Main benefit | One continuous task-to-review conversation. | Flexible organization and a repo-owned technical record. |

People will start work wherever the conversation happens. How do we bring these designs together so the work can gain structure without having to start the conversation over?

- When an existing conversation turns into work, can we give it task identity in place, or do people need to create a task elsewhere and link back?
  - An idea in a general-channel thread becomes a task and is linked to a project.
  - A channel created for a piece of work becomes a standalone task, keeping its audience and history.
- Can tasks be standalone, without belonging to a project or repository?
- Can linked discussions feel like one conversation while retaining separate permissions?

---

## Case-by-case walkthrough

### Three goals

- Keep discussion connected through implementation and review.
- Let work start naturally and gain structure later.
- Let private agent work become collaborative.

### Map the transitions

For each starting place below, work through: how does it become a task, gain collaborators, connect to a project or repository, and proceed through implementation and review? At each transition, what stays in place, what gets linked, and whose access changes? These need not happen in a fixed order.

- Assume people will start work all over the place, wherever the conversation happens. How do we accommodate that and organize the work afterward?

### Where work can start

1. A project channel: a conversation becomes a task.
2. A repository channel: a bug, branch, or code discussion turns into work.
3. A thread outside a project or repository: work emerges in a general channel, DM, or group chat with people or agents.
4. A dedicated channel: a group or standalone agent session focuses on one piece of work without a task record.
5. An existing task or branch thread: a separate piece of work emerges.

Work that starts outside Buzz enters one of these places when brought into Buzz. Handle it through that case rather than as a separate workflow.

### Case 1: work starts in a project-channel thread

People discuss a piece of work in a project thread, make it a task, and begin code changes.

#### Bradley

- Flow: the thread becomes a task, and **branch discussion stays in the project thread**.
- Strength: keeps task and implementation discussion together.
- Weakness: repository maintainers may lack access to the project-owned task discussion.

#### Taylor

- Flow: the thread becomes a task, with **branch discussion in a linked repository thread**.
- Strength: keeps the technical discussion with the repository.
- Weakness: discussion is split.
  - Possible fix: inline expansion, replies, and backlinks can preserve continuity.
- Weakness: task participants may lack access to the repository discussion. Still open.

#### Open

- What must each audience be able to see and participate in? How do we make each reply's destination and audience clear?

### Case 2: work starts in a repository-channel thread

People discuss a bug or change in a repository thread and decide to track the work as a task.

- No project needed: the repository owns the task; discussion stays in the existing thread. Bradley and Taylor seem to agree.
- Project needed: see case three.

### Case 3: work starts in a thread outside a project or repository

Work emerges in a general-channel thread or a thread within an ongoing DM or group chat with people or agents. The originating conversation may have a different audience from the eventual task or project.

#### Bradley

- Flow: if an existing project or repository fits, create the task thread there and link back. Otherwise create a project for the task, or don't create a task.
- Weakness: splits the original discussion from the task discussion.
  - Possible fix: render the originating discussion inline in the task, with a link forward from the origin.
- Weakness: may require creating a new project just for one task.

#### Taylor

- Flow: create a task channel, link back to the originating thread, and link forward from that thread. Connect the task to a project if needed.
- Strength: no project is required.
- Weakness: separates the task discussion from the originating discussion.
  - Possible fix: render the linked discussions inline.
  - Possible change to the model: make the existing thread a task in place, without creating a new channel.
- Weakness: if the task is linked to a project but its discussion is restricted, project members may not be able to read it. Linking does not grant access. Still open.

#### Open

- Can the original thread acquire task identity in place? If not, how do we preserve continuity, and what happens when the two audiences differ?

### Case 4: work starts in a dedicated channel

People have created a channel for a particular piece of work, but it isn't yet a task. This could be a group working together or a standalone agent session. The whole channel is the work conversation, rather than one thread within a broader channel.

#### Bradley

- Flow: create a task thread in an existing project or repository and link back to this channel.
- Alternative: make this existing channel a project channel, then designate a thread inside it as the task. 
  - The channel becomes the project, not the task.

#### Taylor

- Flow: the dedicated channel represents the task, with an optional project link later.
- Strength: keeps the conversation and audience together without requiring a project.
- Weakness: linking a private task channel to a project may leave project members unable to read the task discussion. Linking does not grant access. Still open.

#### Open

- For cases three and four, what can project members see of a linked task they cannot access, and how should they participate? Access to the task discussion and access to its originating discussion may also differ.

### Case 5: new work emerges in an existing task's thread

The thread already represents task X, and someone proposes separate work Y.

- Y gets its own subthread: there is a distinct conversation to reference. Apply case three; Y could become a task or subtask.
- Y stays in X's thread without a subthread: the existing conversation already represents X, so making it Y's task conversation creates a conflict.

#### Possible approach to discuss

- If Y is separate work, start a Y task conversation from this point forward, with a short summary and links to the relevant messages. Leave the mixed history where it is and link forward from X.
- If Y is part of completing X, it may be a scope update rather than another task. Subtask versus independent task is a separate decision from where the conversation lives.

#### Open

- How do we show Y's earlier context without treating the entire mixed thread as Y's discussion?
- What happens if people keep discussing both tasks in the original thread after the split?

### Summary so far

- Common ground to propose: both models benefit from rendering linked discussions inline.
  - Bradley, case 3: connect the originating discussion to the new task thread.
  - Taylor, case 1: connect task and branch discussions.
  - Taylor, case 3: connect the originating discussion to the new task channel.
- Access differences remain open.
- A dedicated task view could gather this context into one place without requiring it all to live in one thread.

Side note: tasks should also support non-coding work, such as research, planning, and coordination, without requiring a repository, branch, or PR.

#### For discussion: make an existing thread a task in place

Could a thread become a task wherever it starts, without creating a new channel or moving the discussion? This would avoid the handoff in case three. Project links could follow later; how those links interact with access remains open.

---

## Scratch

### From single-player to multiplayer

- An important case: start a private coding session with one or more agents, then bring other people into the same conversation.
- If the whole conversation is about one piece of work, adding people could turn the DM-like experience into a group conversation.
- But a persistent agent DM could contain many work sessions, each in a separate thread. Sharing one session should not expose the whole DM.
- Possible approaches: promote the selected thread into a channel and invite people, or grant access to that thread alone.
- Example: discuss X in one thread and work on Y in another within the same agent DM. Bring the team into Y without sharing X.
- Open questions: does promotion move the conversation, copy it, or expose the same thread through another view? How do its history, agent session, task identity, and project links carry forward?

### Dedicated task view

A task could be viewed as a thread in its parent channel or in a dedicated, channel-like view with a task header, description, status, assignee, and branch/PR status, as we've been prototyping. These are different views of the same conversation, not separate discussions.

The dedicated view could bring the originating discussion, task conversation, branch discussions, reviews, and CI into one place, even when they live in different channels. Each source retains its permissions.
