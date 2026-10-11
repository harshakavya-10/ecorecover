# Building EcoRecover AI: helping people decide what to do with old electronics, on AWS

*Publish on AWS Builder Center. Replace every [bracket] with your real experience and add screenshots. Don't publish claims you didn't verify.*

## The problem nobody owns: the drawer full of dead electronics
Almost everyone has one: an old phone, a tangled bag of chargers, a swollen battery. The reason it stays there is simple: nobody tells you what to do with it. Should you repair it? Donate it? Who takes a battery safely? When people give up, items go in the household bin or to informal handlers, where the hazardous parts are the real danger.

For the AWS Waste & Energy track, I wanted to solve this one small problem well: **a person holding an old gadget should know the safest next step in under a minute.**

## What I built
EcoRecover AI is a web app with three parts:
1. **Identify.** Upload a photo and a model suggests the category (phone, laptop, charger, cable, circuit board, battery). The user always confirms it. If the model isn't sure, the app says so and asks the user to choose.
2. **Advise.** Rules prefer reuse and repair first. Batteries are treated as hazardous: no dismantling, no household bin, specialist collection only.
3. **Collect.** The user requests a pickup or drop-off by locality and tracks it. Partners see a queue ranked by a transparent score (days waiting, quantity, hazard flag) with the reasons shown, and hazardous items go to a separate specialist queue.

I deliberately kept the scoring simple and explained. It is not a "prediction model", and the impact numbers in the dashboard are labelled estimates from stated assumptions.

## How AWS fits
- **Amazon Rekognition** `DetectLabels` identifies the item. I map its labels to my categories and treat anything below 70% confidence as uncertain. [Describe what worked and what didn't: which labels it returned for your photos.]
- **AWS App Runner** hosts the Node.js app straight from GitHub. [Describe your deployment experience.]
- **Amazon S3** stores uploaded photos; **IAM** gives the app only the two permissions it needs. [Describe the IAM experience.]

## What I learned
- Generic labels like "Electronics" are common, so the app must be honest about uncertainty. [Add your own finding.]
- A human confirmation step matters more than a few points of accuracy.
- [Add one lesson from the hackathon.]

## What's next
Verified collection partners, locality-based routing with real coordinates, a managed database, and testing with real users in my city.

*Code: [your GitHub link]. Demo: [your video link].*
