using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Developers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    Country = table.Column<string>(type: "TEXT", nullable: true),
                    FoundedYear = table.Column<int>(type: "INTEGER", nullable: true),
                    Website = table.Column<string>(type: "TEXT", nullable: true),
                    LogoUrl = table.Column<string>(type: "TEXT", nullable: true),
                    Description = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Developers", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Games",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Title = table.Column<string>(type: "TEXT", nullable: false),
                    Description = table.Column<string>(type: "TEXT", nullable: true),
                    ReleaseDate = table.Column<DateOnly>(type: "TEXT", nullable: true),
                    CoverImageUrl = table.Column<string>(type: "TEXT", nullable: true),
                    BackgroundImageUrl = table.Column<string>(type: "TEXT", nullable: true),
                    TrailerUrl = table.Column<string>(type: "TEXT", nullable: true),
                    Website = table.Column<string>(type: "TEXT", nullable: true),
                    Rating = table.Column<float>(type: "REAL", nullable: true),
                    MetacriticScore = table.Column<int>(type: "INTEGER", nullable: true),
                    EsrbRating = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Games", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Genres",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    Description = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Genres", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Platforms",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    Abbreviation = table.Column<string>(type: "TEXT", nullable: false),
                    LogoUrl = table.Column<string>(type: "TEXT", nullable: true),
                    Manufacturer = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Platforms", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Publishers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    Country = table.Column<string>(type: "TEXT", nullable: true),
                    FoundedYear = table.Column<int>(type: "INTEGER", nullable: true),
                    Website = table.Column<string>(type: "TEXT", nullable: true),
                    LogoUrl = table.Column<string>(type: "TEXT", nullable: true),
                    Description = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Publishers", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "GameDevelopers",
                columns: table => new
                {
                    GameId = table.Column<int>(type: "INTEGER", nullable: false),
                    DeveloperId = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GameDevelopers", x => new { x.GameId, x.DeveloperId });
                    table.ForeignKey(
                        name: "FK_GameDevelopers_Developers_DeveloperId",
                        column: x => x.DeveloperId,
                        principalTable: "Developers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GameDevelopers_Games_GameId",
                        column: x => x.GameId,
                        principalTable: "Games",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GameGenres",
                columns: table => new
                {
                    GameId = table.Column<int>(type: "INTEGER", nullable: false),
                    GenreId = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GameGenres", x => new { x.GameId, x.GenreId });
                    table.ForeignKey(
                        name: "FK_GameGenres_Games_GameId",
                        column: x => x.GameId,
                        principalTable: "Games",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GameGenres_Genres_GenreId",
                        column: x => x.GenreId,
                        principalTable: "Genres",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GamePlatforms",
                columns: table => new
                {
                    GameId = table.Column<int>(type: "INTEGER", nullable: false),
                    PlatformId = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GamePlatforms", x => new { x.GameId, x.PlatformId });
                    table.ForeignKey(
                        name: "FK_GamePlatforms_Games_GameId",
                        column: x => x.GameId,
                        principalTable: "Games",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GamePlatforms_Platforms_PlatformId",
                        column: x => x.PlatformId,
                        principalTable: "Platforms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GamePublishers",
                columns: table => new
                {
                    GameId = table.Column<int>(type: "INTEGER", nullable: false),
                    PublisherId = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GamePublishers", x => new { x.GameId, x.PublisherId });
                    table.ForeignKey(
                        name: "FK_GamePublishers_Games_GameId",
                        column: x => x.GameId,
                        principalTable: "Games",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GamePublishers_Publishers_PublisherId",
                        column: x => x.PublisherId,
                        principalTable: "Publishers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "Developers",
                columns: new[] { "Id", "Country", "Description", "FoundedYear", "LogoUrl", "Name", "Website" },
                values: new object[,]
                {
                    { 1, "Japan", "Japanese video game developer known for challenging action RPGs.", 1986, null, "FromSoftware", "https://www.fromsoftware.jp" },
                    { 2, "Japan", "Nintendo's internal development division responsible for major first-party titles.", 2015, null, "Nintendo EPD", "https://www.nintendo.com" },
                    { 3, "United States", "Sony's first-party studio and creator of the God of War series.", 1999, null, "Santa Monica Studio", "https://sms.playstation.com" },
                    { 4, "Poland", "Polish studio behind The Witcher series and Cyberpunk 2077.", 2002, null, "CD Projekt RED", "https://www.cdprojektred.com" },
                    { 5, "United States", "Independent studio known for Bastion, Transistor, Pyre, and Hades.", 2009, null, "Supergiant Games", "https://www.supergiantgames.com" }
                });

            migrationBuilder.InsertData(
                table: "Games",
                columns: new[] { "Id", "BackgroundImageUrl", "CoverImageUrl", "Description", "EsrbRating", "MetacriticScore", "Rating", "ReleaseDate", "Title", "TrailerUrl", "Website" },
                values: new object[,]
                {
                    { 1, "https://upload.wikimedia.org/wikipedia/en/b/b9/Elden_Ring_Box_art.jpg", "https://upload.wikimedia.org/wikipedia/en/b/b9/Elden_Ring_Box_art.jpg", "A fantasy action RPG set in the Lands Between, co-created by Hidetaka Miyazaki and George R. R. Martin. Players explore a vast open world, battle fearsome bosses, and unravel the mystery of the shattered Elden Ring.", "M", 96, 9.5f, new DateOnly(2022, 2, 25), "Elden Ring", "https://www.youtube.com/watch?v=E3Huy2cdih0", "https://en.bandainamcoent.eu/elden-ring/elden-ring" },
                    { 2, "https://upload.wikimedia.org/wikipedia/en/c/c6/The_Legend_of_Zelda_Breath_of_the_Wild.jpg", "https://upload.wikimedia.org/wikipedia/en/c/c6/The_Legend_of_Zelda_Breath_of_the_Wild.jpg", "An open-world action-adventure game in which Link awakens from a long slumber to defeat Calamity Ganon. Players explore the vast kingdom of Hyrule with complete freedom and unparalleled creativity.", "E10+", 97, 9.7f, new DateOnly(2017, 3, 3), "The Legend of Zelda: Breath of the Wild", "https://www.youtube.com/watch?v=zw47_q9wbBE", "https://www.zelda.com/breath-of-the-wild/" },
                    { 3, "https://upload.wikimedia.org/wikipedia/en/e/ee/God_of_War_Ragnar%C3%B6k_cover.jpg", "https://upload.wikimedia.org/wikipedia/en/e/ee/God_of_War_Ragnar%C3%B6k_cover.jpg", "Kratos and Atreus must journey to each of the Nine Realms in search of answers as Asgardian forces prepare for war. Facing an imminent Ragnarök, they must decide which path to take.", "M", 94, 9.4f, new DateOnly(2022, 11, 9), "God of War Ragnarök", "https://www.youtube.com/watch?v=7XFi6Fjo4Ek", "https://www.playstation.com/en-us/games/god-of-war-ragnarok/" },
                    { 4, "https://upload.wikimedia.org/wikipedia/en/9/9f/Cyberpunk_2077_box_art.jpg", "https://upload.wikimedia.org/wikipedia/en/9/9f/Cyberpunk_2077_box_art.jpg", "An open-world action RPG set in the megalopolis of Night City. Players take on the role of V, a mercenary outlaw going after a one-of-a-kind implant that is the key to immortality.", "M", 86, 8.5f, new DateOnly(2020, 12, 10), "Cyberpunk 2077", "https://www.youtube.com/watch?v=qIcTM8WXFjk", "https://www.cyberpunk.net" },
                    { 5, "https://upload.wikimedia.org/wikipedia/en/c/cc/Hades_cover_art.jpg", "https://upload.wikimedia.org/wikipedia/en/c/cc/Hades_cover_art.jpg", "A rogue-like dungeon crawler in which the player takes on the role of Prince Zagreus, the son of Hades, attempting to escape from the Underworld. Each escape attempt features procedurally generated rooms.", "T", 93, 9.3f, new DateOnly(2020, 9, 17), "Hades", "https://www.youtube.com/watch?v=91t0ha9x0AE", "https://www.supergiantgames.com/games/hades/" }
                });

            migrationBuilder.InsertData(
                table: "Genres",
                columns: new[] { "Id", "Description", "Name" },
                values: new object[,]
                {
                    { 1, "Action game with role-playing elements", "Action RPG" },
                    { 2, "Combines action and adventure gameplay", "Action-Adventure" },
                    { 3, "Large explorable game world", "Open World" },
                    { 4, "Procedurally generated levels with permadeath", "Roguelike" },
                    { 5, "Shooter game from a first-person perspective", "First-Person Shooter" },
                    { 6, "Story-driven game with character progression", "Role-Playing Game" },
                    { 7, "Navigate platforms and obstacles", "Platformer" }
                });

            migrationBuilder.InsertData(
                table: "Platforms",
                columns: new[] { "Id", "Abbreviation", "LogoUrl", "Manufacturer", "Name" },
                values: new object[,]
                {
                    { 1, "PC", null, "Various", "PC" },
                    { 2, "PS5", null, "Sony", "PlayStation 5" },
                    { 3, "PS4", null, "Sony", "PlayStation 4" },
                    { 4, "XSX", null, "Microsoft", "Xbox Series X|S" },
                    { 5, "XBO", null, "Microsoft", "Xbox One" },
                    { 6, "NSW", null, "Nintendo", "Nintendo Switch" }
                });

            migrationBuilder.InsertData(
                table: "Publishers",
                columns: new[] { "Id", "Country", "Description", "FoundedYear", "LogoUrl", "Name", "Website" },
                values: new object[,]
                {
                    { 1, "Japan", "Major Japanese publisher and co-publisher of Elden Ring.", 2005, null, "Bandai Namco Entertainment", "https://www.bandainamcoent.com" },
                    { 2, "Japan", "Japanese multinational video game company.", 1889, null, "Nintendo", "https://www.nintendo.com" },
                    { 3, "United States", "Publisher of PlayStation first-party titles.", 1993, null, "Sony Interactive Entertainment", "https://www.playstation.com" },
                    { 4, "Poland", "Polish video game publisher and parent company of CD Projekt RED.", 1994, null, "CD Projekt", "https://www.cdprojekt.com" },
                    { 5, "United States", "Independent studio that self-publishes its own games.", 2009, null, "Supergiant Games", "https://www.supergiantgames.com" }
                });

            migrationBuilder.InsertData(
                table: "GameDevelopers",
                columns: new[] { "DeveloperId", "GameId" },
                values: new object[,]
                {
                    { 1, 1 },
                    { 2, 2 },
                    { 3, 3 },
                    { 4, 4 },
                    { 5, 5 }
                });

            migrationBuilder.InsertData(
                table: "GameGenres",
                columns: new[] { "GameId", "GenreId" },
                values: new object[,]
                {
                    { 1, 1 },
                    { 1, 3 },
                    { 2, 2 },
                    { 2, 3 },
                    { 3, 2 },
                    { 4, 1 },
                    { 4, 3 },
                    { 4, 6 },
                    { 5, 1 },
                    { 5, 4 }
                });

            migrationBuilder.InsertData(
                table: "GamePlatforms",
                columns: new[] { "GameId", "PlatformId" },
                values: new object[,]
                {
                    { 1, 1 },
                    { 1, 2 },
                    { 1, 3 },
                    { 1, 4 },
                    { 1, 5 },
                    { 2, 6 },
                    { 3, 1 },
                    { 3, 2 },
                    { 3, 3 },
                    { 4, 1 },
                    { 4, 2 },
                    { 4, 3 },
                    { 4, 4 },
                    { 4, 5 },
                    { 5, 1 },
                    { 5, 2 },
                    { 5, 3 },
                    { 5, 4 },
                    { 5, 5 },
                    { 5, 6 }
                });

            migrationBuilder.InsertData(
                table: "GamePublishers",
                columns: new[] { "GameId", "PublisherId" },
                values: new object[,]
                {
                    { 1, 1 },
                    { 2, 2 },
                    { 3, 3 },
                    { 4, 4 },
                    { 5, 5 }
                });

            migrationBuilder.CreateIndex(
                name: "IX_GameDevelopers_DeveloperId",
                table: "GameDevelopers",
                column: "DeveloperId");

            migrationBuilder.CreateIndex(
                name: "IX_GameGenres_GenreId",
                table: "GameGenres",
                column: "GenreId");

            migrationBuilder.CreateIndex(
                name: "IX_GamePlatforms_PlatformId",
                table: "GamePlatforms",
                column: "PlatformId");

            migrationBuilder.CreateIndex(
                name: "IX_GamePublishers_PublisherId",
                table: "GamePublishers",
                column: "PublisherId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GameDevelopers");

            migrationBuilder.DropTable(
                name: "GameGenres");

            migrationBuilder.DropTable(
                name: "GamePlatforms");

            migrationBuilder.DropTable(
                name: "GamePublishers");

            migrationBuilder.DropTable(
                name: "Developers");

            migrationBuilder.DropTable(
                name: "Genres");

            migrationBuilder.DropTable(
                name: "Platforms");

            migrationBuilder.DropTable(
                name: "Games");

            migrationBuilder.DropTable(
                name: "Publishers");
        }
    }
}
