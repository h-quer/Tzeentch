<h1 align="center">
  <img src="/public/tzeentch.png" width="auto" height="48"/>
  <br>
  Tzeentch
</h1>
<p align="center">The self-hosted book tracker</p>

---

## What is Tzeentch?
Tzeentch is a self-hosted book tracker. Query Google Books, Audible or Goodreads for metadata, log books you are reading, have read, plan to read, or plan to get.

I built it because I was looking for a self-hosted Goodreads replacements without any social features. Just a simple tracker to show what I have read.

There are some other self-hostable services already that do very similar things, but they mostly focus on books and don't deal well with audiobooks. I wanted to be able to integrate audiobooks just as prominently as books.

## It's an early release and was designed primarily with AI, will it keep my data safe?
Yes, absolutely!

I did primarily use the Gemini AI to create this. It is "just" a kind-of fancy UI on top of a CSV file, though.
All data (except cover images) are kept in this CSV file. No database, no arbitrary abstraction, just plain text files.
You should, of course, have a 3-2-1 backup strategy already and you should make sure that the bind mount with the CSV file is part of it.

## Screenshots
Card view in light mode and list view in dark mode.

<p align="center">
  <img src="/images/light.png" alt="reading_list_light" width="48%"/>
  <img src="/images/dark.png" alt="reading_list_dark" width="48%"/>
</p>

## Setup and installation

### Docker setup

You can simply use the following docker-compose.yml to spin up Tzeentch. Make sure to create the volumes as needed.

```yaml
---
services:
  tzeentch:
    image: ghcr.io/h-quer/tzeentch:latest
    container_name: tzeentch
    restart: unless-stopped
    volumes:
      - /your_tzeentch_dir/data:/app/data       # adjust path
    ports:
      - 8421:3000                               # remove if using reverse proxy and accessing via container name
```
Once it's set, simply pull and start the image:
```
docker compose up -d
```

Tzeentch should now be watching your specified port (8421 in the example above).

### Directories and the config file

All data is stored in the data directory. Make sure that it exists and is readable / writable from within the container using the UID and GID set with the environment variable.

### Security

Tzeentch does not offer logins or any kind of security measures. This should be fine if only using it locally or behind a VPN, but even then you might want to put it behind an auth provider. Something like Caddy basic auth is advisable, or a more full-featured solution like Authentik.
If you want to expose this to the Internet, you should definitely put it behind a proper auth solution.
Tzeentch does not and will not provide auth functionality, for the simple reason that I trust neither myself nor some AI to design a safe one. Leave it to the professionaly, use an existing and tested auth solution.

## Scope and roadmap
### Continuous support

I use Tzeentch for myself. I will continue to support it since I want to continue using it. That being said, it's build primarily with my use case in mind and it is a hoppy/side project.

I'm more than happy to expand it to cover additional use cases if they fit the overall theme, but I don't want to over-complicate it.

### Not in scope

* Auth functionality or any team/sharing features.
* Any sort of database backend.
* Data export functionality. Everything (except covers) is stored as simple CSV file in your bind mount. You can simply copy it. A dedicated export functionality would be redundant.

### Improvements I hope to implement (eventually)

* Lots of tiny usability improvements that will probably pop up over time.
* Possibly more metadata proviers
* Generic CSV import functionality in addition to the Goodreads one
* Cover update / refresh without having to do a full metadata refresh

## How to contribute
Bug reports are always useful (if you run into bugs, which of course I hope won't happen ...).
I'm also happy to get feature requests as long as they fit with the overall theme of Tzeentch.
