using Microsoft.AspNetCore.Identity;

namespace MyVideoGameList.Server.Models;

public class ApplicationUser : IdentityUser
{
    public string Theme { get; set; } = "dark";
}
