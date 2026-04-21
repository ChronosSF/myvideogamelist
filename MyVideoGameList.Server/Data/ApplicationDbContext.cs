using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Data;

public class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
    : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<Game> Games { get; set; }
    public DbSet<Developer> Developers { get; set; }
    public DbSet<Publisher> Publishers { get; set; }
    public DbSet<Platform> Platforms { get; set; }
    public DbSet<Genre> Genres { get; set; }
    public DbSet<GamePlatform> GamePlatforms { get; set; }
    public DbSet<GameGenre> GameGenres { get; set; }
    public DbSet<GameDeveloper> GameDevelopers { get; set; }
    public DbSet<GamePublisher> GamePublishers { get; set; }
    public DbSet<UserGameList> UserGameLists { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Composite primary keys for join tables
        modelBuilder.Entity<GamePlatform>().HasKey(gp => new { gp.GameId, gp.PlatformId });
        modelBuilder.Entity<GameGenre>().HasKey(gg => new { gg.GameId, gg.GenreId });
        modelBuilder.Entity<GameDeveloper>().HasKey(gd => new { gd.GameId, gd.DeveloperId });
        modelBuilder.Entity<GamePublisher>().HasKey(gp => new { gp.GameId, gp.PublisherId });

        // UserGameList: composite PK on (UserId, GameId); cascade delete when user is deleted
        modelBuilder.Entity<UserGameList>().HasKey(ul => new { ul.UserId, ul.GameId });
        modelBuilder.Entity<UserGameList>()
            .HasOne(ul => ul.User)
            .WithMany()
            .HasForeignKey(ul => ul.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        SeedData(modelBuilder);
    }

    private static void SeedData(ModelBuilder modelBuilder)
    {
        // --- Platforms ---
        modelBuilder.Entity<Platform>().HasData(
            new Platform { Id = 1, Name = "PC", Abbreviation = "PC", Manufacturer = "Various" },
            new Platform { Id = 2, Name = "PlayStation 5", Abbreviation = "PS5", Manufacturer = "Sony" },
            new Platform { Id = 3, Name = "PlayStation 4", Abbreviation = "PS4", Manufacturer = "Sony" },
            new Platform { Id = 4, Name = "Xbox Series X|S", Abbreviation = "XSX", Manufacturer = "Microsoft" },
            new Platform { Id = 5, Name = "Xbox One", Abbreviation = "XBO", Manufacturer = "Microsoft" },
            new Platform { Id = 6, Name = "Nintendo Switch", Abbreviation = "NSW", Manufacturer = "Nintendo" }
        );

        // --- Genres ---
        modelBuilder.Entity<Genre>().HasData(
            new Genre { Id = 1, Name = "Action RPG", Description = "Action game with role-playing elements" },
            new Genre { Id = 2, Name = "Action-Adventure", Description = "Combines action and adventure gameplay" },
            new Genre { Id = 3, Name = "Open World", Description = "Large explorable game world" },
            new Genre { Id = 4, Name = "Roguelike", Description = "Procedurally generated levels with permadeath" },
            new Genre { Id = 5, Name = "First-Person Shooter", Description = "Shooter game from a first-person perspective" },
            new Genre { Id = 6, Name = "Role-Playing Game", Description = "Story-driven game with character progression" },
            new Genre { Id = 7, Name = "Platformer", Description = "Navigate platforms and obstacles" }
        );

        // --- Developers ---
        modelBuilder.Entity<Developer>().HasData(
            new Developer
            {
                Id = 1, Name = "FromSoftware", Country = "Japan", FoundedYear = 1986,
                Website = "https://www.fromsoftware.jp",
                Description = "Japanese video game developer known for challenging action RPGs."
            },
            new Developer
            {
                Id = 2, Name = "Nintendo EPD", Country = "Japan", FoundedYear = 2015,
                Website = "https://www.nintendo.com",
                Description = "Nintendo's internal development division responsible for major first-party titles."
            },
            new Developer
            {
                Id = 3, Name = "Santa Monica Studio", Country = "United States", FoundedYear = 1999,
                Website = "https://sms.playstation.com",
                Description = "Sony's first-party studio and creator of the God of War series."
            },
            new Developer
            {
                Id = 4, Name = "CD Projekt RED", Country = "Poland", FoundedYear = 2002,
                Website = "https://www.cdprojektred.com",
                Description = "Polish studio behind The Witcher series and Cyberpunk 2077."
            },
            new Developer
            {
                Id = 5, Name = "Supergiant Games", Country = "United States", FoundedYear = 2009,
                Website = "https://www.supergiantgames.com",
                Description = "Independent studio known for Bastion, Transistor, Pyre, and Hades."
            }
        );

        // --- Publishers ---
        modelBuilder.Entity<Publisher>().HasData(
            new Publisher
            {
                Id = 1, Name = "Bandai Namco Entertainment", Country = "Japan", FoundedYear = 2005,
                Website = "https://www.bandainamcoent.com",
                Description = "Major Japanese publisher and co-publisher of Elden Ring."
            },
            new Publisher
            {
                Id = 2, Name = "Nintendo", Country = "Japan", FoundedYear = 1889,
                Website = "https://www.nintendo.com",
                Description = "Japanese multinational video game company."
            },
            new Publisher
            {
                Id = 3, Name = "Sony Interactive Entertainment", Country = "United States", FoundedYear = 1993,
                Website = "https://www.playstation.com",
                Description = "Publisher of PlayStation first-party titles."
            },
            new Publisher
            {
                Id = 4, Name = "CD Projekt", Country = "Poland", FoundedYear = 1994,
                Website = "https://www.cdprojekt.com",
                Description = "Polish video game publisher and parent company of CD Projekt RED."
            },
            new Publisher
            {
                Id = 5, Name = "Supergiant Games", Country = "United States", FoundedYear = 2009,
                Website = "https://www.supergiantgames.com",
                Description = "Independent studio that self-publishes its own games."
            }
        );

        // --- Games ---
        modelBuilder.Entity<Game>().HasData(
            new Game
            {
                Id = 1,
                Title = "Elden Ring",
                Description = "A fantasy action RPG set in the Lands Between, co-created by Hidetaka Miyazaki and George R. R. Martin. Players explore a vast open world, battle fearsome bosses, and unravel the mystery of the shattered Elden Ring.",
                ReleaseDate = new DateOnly(2022, 2, 25),
                CoverImageUrl = "https://upload.wikimedia.org/wikipedia/en/b/b9/Elden_Ring_Box_art.jpg",
                BackgroundImageUrl = "https://upload.wikimedia.org/wikipedia/en/b/b9/Elden_Ring_Box_art.jpg",
                TrailerUrl = "https://www.youtube.com/watch?v=E3Huy2cdih0",
                Website = "https://en.bandainamcoent.eu/elden-ring/elden-ring",
                Rating = 9.5f,
                MetacriticScore = 96,
                EsrbRating = "M"
            },
            new Game
            {
                Id = 2,
                Title = "The Legend of Zelda: Breath of the Wild",
                Description = "An open-world action-adventure game in which Link awakens from a long slumber to defeat Calamity Ganon. Players explore the vast kingdom of Hyrule with complete freedom and unparalleled creativity.",
                ReleaseDate = new DateOnly(2017, 3, 3),
                CoverImageUrl = "https://upload.wikimedia.org/wikipedia/en/c/c6/The_Legend_of_Zelda_Breath_of_the_Wild.jpg",
                BackgroundImageUrl = "https://upload.wikimedia.org/wikipedia/en/c/c6/The_Legend_of_Zelda_Breath_of_the_Wild.jpg",
                TrailerUrl = "https://www.youtube.com/watch?v=zw47_q9wbBE",
                Website = "https://www.zelda.com/breath-of-the-wild/",
                Rating = 9.7f,
                MetacriticScore = 97,
                EsrbRating = "E10+"
            },
            new Game
            {
                Id = 3,
                Title = "God of War Ragnarök",
                Description = "Kratos and Atreus must journey to each of the Nine Realms in search of answers as Asgardian forces prepare for war. Facing an imminent Ragnarök, they must decide which path to take.",
                ReleaseDate = new DateOnly(2022, 11, 9),
                CoverImageUrl = "https://upload.wikimedia.org/wikipedia/en/e/ee/God_of_War_Ragnar%C3%B6k_cover.jpg",
                BackgroundImageUrl = "https://upload.wikimedia.org/wikipedia/en/e/ee/God_of_War_Ragnar%C3%B6k_cover.jpg",
                TrailerUrl = "https://www.youtube.com/watch?v=7XFi6Fjo4Ek",
                Website = "https://www.playstation.com/en-us/games/god-of-war-ragnarok/",
                Rating = 9.4f,
                MetacriticScore = 94,
                EsrbRating = "M"
            },
            new Game
            {
                Id = 4,
                Title = "Cyberpunk 2077",
                Description = "An open-world action RPG set in the megalopolis of Night City. Players take on the role of V, a mercenary outlaw going after a one-of-a-kind implant that is the key to immortality.",
                ReleaseDate = new DateOnly(2020, 12, 10),
                CoverImageUrl = "https://upload.wikimedia.org/wikipedia/en/9/9f/Cyberpunk_2077_box_art.jpg",
                BackgroundImageUrl = "https://upload.wikimedia.org/wikipedia/en/9/9f/Cyberpunk_2077_box_art.jpg",
                TrailerUrl = "https://www.youtube.com/watch?v=qIcTM8WXFjk",
                Website = "https://www.cyberpunk.net",
                Rating = 8.5f,
                MetacriticScore = 86,
                EsrbRating = "M"
            },
            new Game
            {
                Id = 5,
                Title = "Hades",
                Description = "A rogue-like dungeon crawler in which the player takes on the role of Prince Zagreus, the son of Hades, attempting to escape from the Underworld. Each escape attempt features procedurally generated rooms.",
                ReleaseDate = new DateOnly(2020, 9, 17),
                CoverImageUrl = "https://upload.wikimedia.org/wikipedia/en/c/cc/Hades_cover_art.jpg",
                BackgroundImageUrl = "https://upload.wikimedia.org/wikipedia/en/c/cc/Hades_cover_art.jpg",
                TrailerUrl = "https://www.youtube.com/watch?v=91t0ha9x0AE",
                Website = "https://www.supergiantgames.com/games/hades/",
                Rating = 9.3f,
                MetacriticScore = 93,
                EsrbRating = "T"
            }
        );

        // --- Game ↔ Platform links ---
        // Elden Ring: PC, PS5, PS4, XSX, XBO
        modelBuilder.Entity<GamePlatform>().HasData(
            new GamePlatform { GameId = 1, PlatformId = 1 },
            new GamePlatform { GameId = 1, PlatformId = 2 },
            new GamePlatform { GameId = 1, PlatformId = 3 },
            new GamePlatform { GameId = 1, PlatformId = 4 },
            new GamePlatform { GameId = 1, PlatformId = 5 },
            // Zelda: BotW: NSW
            new GamePlatform { GameId = 2, PlatformId = 6 },
            // God of War Ragnarök: PS5, PS4, PC
            new GamePlatform { GameId = 3, PlatformId = 2 },
            new GamePlatform { GameId = 3, PlatformId = 3 },
            new GamePlatform { GameId = 3, PlatformId = 1 },
            // Cyberpunk 2077: PC, PS5, PS4, XSX, XBO
            new GamePlatform { GameId = 4, PlatformId = 1 },
            new GamePlatform { GameId = 4, PlatformId = 2 },
            new GamePlatform { GameId = 4, PlatformId = 3 },
            new GamePlatform { GameId = 4, PlatformId = 4 },
            new GamePlatform { GameId = 4, PlatformId = 5 },
            // Hades: PC, NSW, PS5, PS4, XSX, XBO
            new GamePlatform { GameId = 5, PlatformId = 1 },
            new GamePlatform { GameId = 5, PlatformId = 6 },
            new GamePlatform { GameId = 5, PlatformId = 2 },
            new GamePlatform { GameId = 5, PlatformId = 3 },
            new GamePlatform { GameId = 5, PlatformId = 4 },
            new GamePlatform { GameId = 5, PlatformId = 5 }
        );

        // --- Game ↔ Genre links ---
        // Elden Ring: Action RPG, Open World
        modelBuilder.Entity<GameGenre>().HasData(
            new GameGenre { GameId = 1, GenreId = 1 },
            new GameGenre { GameId = 1, GenreId = 3 },
            // Zelda BotW: Action-Adventure, Open World
            new GameGenre { GameId = 2, GenreId = 2 },
            new GameGenre { GameId = 2, GenreId = 3 },
            // God of War Ragnarök: Action-Adventure
            new GameGenre { GameId = 3, GenreId = 2 },
            // Cyberpunk 2077: Action RPG, Open World, RPG
            new GameGenre { GameId = 4, GenreId = 1 },
            new GameGenre { GameId = 4, GenreId = 3 },
            new GameGenre { GameId = 4, GenreId = 6 },
            // Hades: Roguelike, Action RPG
            new GameGenre { GameId = 5, GenreId = 4 },
            new GameGenre { GameId = 5, GenreId = 1 }
        );

        // --- Game ↔ Developer links ---
        modelBuilder.Entity<GameDeveloper>().HasData(
            new GameDeveloper { GameId = 1, DeveloperId = 1 },  // Elden Ring → FromSoftware
            new GameDeveloper { GameId = 2, DeveloperId = 2 },  // Zelda BotW → Nintendo EPD
            new GameDeveloper { GameId = 3, DeveloperId = 3 },  // GoW Ragnarök → Santa Monica Studio
            new GameDeveloper { GameId = 4, DeveloperId = 4 },  // Cyberpunk 2077 → CD Projekt RED
            new GameDeveloper { GameId = 5, DeveloperId = 5 }   // Hades → Supergiant Games
        );

        // --- Game ↔ Publisher links ---
        modelBuilder.Entity<GamePublisher>().HasData(
            new GamePublisher { GameId = 1, PublisherId = 1 },  // Elden Ring → Bandai Namco
            new GamePublisher { GameId = 2, PublisherId = 2 },  // Zelda BotW → Nintendo
            new GamePublisher { GameId = 3, PublisherId = 3 },  // GoW Ragnarök → Sony Interactive Entertainment
            new GamePublisher { GameId = 4, PublisherId = 4 },  // Cyberpunk 2077 → CD Projekt
            new GamePublisher { GameId = 5, PublisherId = 5 }   // Hades → Supergiant Games
        );
    }
}
