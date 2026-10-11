# Submission helper (edit anything not yet true!)

**Project title:** EcoRecover AI: Know what to do with your old electronics

**What does your project do?** (problem + who it is for)
Households in Indian cities keep old phones, chargers and batteries in drawers or throw them in household bins because they don't know whether to repair, donate or recycle them, or who will take them safely. Batteries are especially risky. EcoRecover AI lets a person upload a photo; a model suggests the item type; the person confirms it and gets clear, safe guidance (reuse, repair, or collection, with batteries handled as hazardous). They can request a pickup or drop-off by locality and track it. Collection partners get a queue ranked by a transparent score (waiting time, quantity, hazard flag) with the reasons shown, so the longest-waiting and hazardous requests are not missed.

**How did you use AWS?** (keep only what you actually did)
- AWS services: Amazon Rekognition (DetectLabels for item identification), AWS App Runner (hosting the Node.js app), Amazon S3 (image storage), IAM (least-privilege instance role: rekognition:DetectLabels and s3:PutObject on one prefix).
- AWS open source: [none used / add e.g. LocalStack if you used it for local testing].

**Feedback: what you didn't like** (write from YOUR real experience; examples of useful specifics)
- Which service, which step, what confused you (e.g. IAM trust policy for the App Runner instance role vs access role; runtime options in App Runner; Rekognition returning generic labels like "Electronics"). Be specific and honest.

**Feedback: what you liked**
- Same: name the services and what worked (e.g. Rekognition needing no training, App Runner deploying from GitHub). Only write what you experienced.

**Demo video (3 min) script**
0:00 Problem (drawer e-waste, risky batteries). 0:25 Log in, upload a photo, show result and confirm. 1:00 Show recommendation (then a battery, with hazard warning). 1:25 Submit request, show the ID and tracking. 1:50 Log in as partner: ranked queue with reasons, update status. 2:20 Analytics update. 2:40 Where AWS fits: Rekognition, App Runner, S3 (show the console). Say clearly: sample data, unverified partners.
