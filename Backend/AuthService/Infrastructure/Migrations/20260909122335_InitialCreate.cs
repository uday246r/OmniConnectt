using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuthService.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AuditLogs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ServiceName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ActorUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ActorName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Action = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    EntityType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    EntityId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    EntityLabel = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    Details = table.Column<string>(type: "text", nullable: true),
                    SourceIp = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    AuthMethod = table.Column<string>(type: "text", nullable: true),
                    Result = table.Column<string>(type: "text", nullable: false),
                    UserAgent = table.Column<string>(type: "text", nullable: true),
                    FailureReason = table.Column<string>(type: "text", nullable: true),
                    CorrelationId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuditLogs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "NavSections",
                columns: table => new
                {
                    Key = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Label = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    PinToBottom = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NavSections", x => x.Key);
                });

            migrationBuilder.CreateTable(
                name: "PermissionFeatures",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Source = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    ParentFeatureId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PermissionFeatures", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PermissionFeatures_PermissionFeatures_ParentFeatureId",
                        column: x => x.ParentFeatureId,
                        principalTable: "PermissionFeatures",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Roles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    IsSystemRole = table.Column<bool>(type: "boolean", nullable: false),
                    IsAdministrator = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Roles", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "HostNavItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Label = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    IconKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    RoutePath = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    SectionKey = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    RequiredFeatureKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    RequiredCapability = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HostNavItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HostNavItems_NavSections_SectionKey",
                        column: x => x.SectionKey,
                        principalTable: "NavSections",
                        principalColumn: "Key",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "FeatureNavItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FeatureId = table.Column<Guid>(type: "uuid", nullable: false),
                    NavKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Label = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    IconKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    RouteSegment = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    RequiredCapability = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FeatureNavItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FeatureNavItems_PermissionFeatures_FeatureId",
                        column: x => x.FeatureId,
                        principalTable: "PermissionFeatures",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PermissionFeatureCapabilities",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FeatureId = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    GroupKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PermissionFeatureCapabilities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PermissionFeatureCapabilities_PermissionFeatures_FeatureId",
                        column: x => x.FeatureId,
                        principalTable: "PermissionFeatures",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RemoteAppNavMetadata",
                columns: table => new
                {
                    FeatureId = table.Column<Guid>(type: "uuid", nullable: false),
                    IconKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ManifestUrl = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    ContainerName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    MaintenanceMessage = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RemoteAppNavMetadata", x => x.FeatureId);
                    table.ForeignKey(
                        name: "FK_RemoteAppNavMetadata_PermissionFeatures_FeatureId",
                        column: x => x.FeatureId,
                        principalTable: "PermissionFeatures",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RolePermissions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoleId = table.Column<Guid>(type: "uuid", nullable: false),
                    FeatureId = table.Column<Guid>(type: "uuid", nullable: false),
                    Capability = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RolePermissions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RolePermissions_PermissionFeatures_FeatureId",
                        column: x => x.FeatureId,
                        principalTable: "PermissionFeatures",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RolePermissions_Roles_RoleId",
                        column: x => x.RoleId,
                        principalTable: "Roles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    PhoneNumber = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    PasswordHash = table.Column<string>(type: "text", nullable: true),
                    AuthProvider = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false),
                    RoleId = table.Column<Guid>(type: "uuid", nullable: true),
                    MustChangePassword = table.Column<bool>(type: "boolean", nullable: false),
                    LastLoginAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Users_Roles_RoleId",
                        column: x => x.RoleId,
                        principalTable: "Roles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ApprovalRequests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Module = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Action = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    EntityType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    EntityId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    EntityLabel = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    EntityKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    OldDataJson = table.Column<string>(type: "text", nullable: true),
                    NewDataJson = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    MakerId = table.Column<Guid>(type: "uuid", nullable: false),
                    MakerName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CheckerId = table.Column<Guid>(type: "uuid", nullable: false),
                    CheckerName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    RequestedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    DecidedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RejectionReason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    SourceService = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    CallbackUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CorrelationId = table.Column<string>(type: "text", nullable: true),
                    TempPasswordCiphertext = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    TempPasswordRevealedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RowVersion = table.Column<byte[]>(type: "bytea", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ApprovalRequests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ApprovalRequests_Users_CheckerId",
                        column: x => x.CheckerId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ApprovalRequests_Users_MakerId",
                        column: x => x.MakerId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CheckerAssignments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Module = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    CheckerUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CheckerRoleId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckerAssignments", x => x.Id);
                    table.CheckConstraint("CK_CheckerAssignment_UserOrRole", "(\"CheckerUserId\" IS NOT NULL AND \"CheckerRoleId\" IS NULL) OR (\"CheckerUserId\" IS NULL AND \"CheckerRoleId\" IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_CheckerAssignments_Roles_CheckerRoleId",
                        column: x => x.CheckerRoleId,
                        principalTable: "Roles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CheckerAssignments_Users_CheckerUserId",
                        column: x => x.CheckerUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RefreshTokens",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    AbsoluteExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RevokedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ReplacedByTokenId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedByIp = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RefreshTokens", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RefreshTokens_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SetPasswordInvites",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UsedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RevokedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SetPasswordInvites", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SetPasswordInvites_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "UserPermissionOverrides",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    FeatureId = table.Column<Guid>(type: "uuid", nullable: false),
                    Capability = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Effect = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserPermissionOverrides", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserPermissionOverrides_PermissionFeatures_FeatureId",
                        column: x => x.FeatureId,
                        principalTable: "PermissionFeatures",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_UserPermissionOverrides_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ApprovalRequests_CheckerId_Status",
                table: "ApprovalRequests",
                columns: new[] { "CheckerId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_ApprovalRequests_MakerId_RequestedAt",
                table: "ApprovalRequests",
                columns: new[] { "MakerId", "RequestedAt" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "IX_ApprovalRequests_Module_EntityKey",
                table: "ApprovalRequests",
                columns: new[] { "Module", "EntityKey" },
                unique: true,
                filter: "\"Status\" = 'Pending'");

            migrationBuilder.CreateIndex(
                name: "IX_ApprovalRequests_Module_Status",
                table: "ApprovalRequests",
                columns: new[] { "Module", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_ApprovalRequests_Status_RequestedAt",
                table: "ApprovalRequests",
                columns: new[] { "Status", "RequestedAt" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_Action",
                table: "AuditLogs",
                column: "Action");

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_ActorUserId",
                table: "AuditLogs",
                column: "ActorUserId");

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_OccurredAt",
                table: "AuditLogs",
                column: "OccurredAt");

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_Result_OccurredAt",
                table: "AuditLogs",
                columns: new[] { "Result", "OccurredAt" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_ServiceName",
                table: "AuditLogs",
                column: "ServiceName");

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_ServiceName_OccurredAt",
                table: "AuditLogs",
                columns: new[] { "ServiceName", "OccurredAt" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "IX_CheckerAssignments_CheckerRoleId",
                table: "CheckerAssignments",
                column: "CheckerRoleId");

            migrationBuilder.CreateIndex(
                name: "IX_CheckerAssignments_CheckerUserId",
                table: "CheckerAssignments",
                column: "CheckerUserId");

            migrationBuilder.CreateIndex(
                name: "IX_CheckerAssignments_Module",
                table: "CheckerAssignments",
                column: "Module");

            migrationBuilder.CreateIndex(
                name: "IX_CheckerAssignments_Module_CheckerRoleId",
                table: "CheckerAssignments",
                columns: new[] { "Module", "CheckerRoleId" },
                unique: true,
                filter: "\"CheckerRoleId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CheckerAssignments_Module_CheckerUserId",
                table: "CheckerAssignments",
                columns: new[] { "Module", "CheckerUserId" },
                unique: true,
                filter: "\"CheckerUserId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_FeatureNavItems_FeatureId_NavKey",
                table: "FeatureNavItems",
                columns: new[] { "FeatureId", "NavKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_HostNavItems_Key",
                table: "HostNavItems",
                column: "Key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_HostNavItems_SectionKey",
                table: "HostNavItems",
                column: "SectionKey");

            migrationBuilder.CreateIndex(
                name: "IX_PermissionFeatureCapabilities_FeatureId_Key",
                table: "PermissionFeatureCapabilities",
                columns: new[] { "FeatureId", "Key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PermissionFeatures_Key",
                table: "PermissionFeatures",
                column: "Key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PermissionFeatures_ParentFeatureId",
                table: "PermissionFeatures",
                column: "ParentFeatureId");

            migrationBuilder.CreateIndex(
                name: "IX_RefreshTokens_ExpiresAt",
                table: "RefreshTokens",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_RefreshTokens_TokenHash",
                table: "RefreshTokens",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RefreshTokens_UserId",
                table: "RefreshTokens",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_RolePermissions_FeatureId",
                table: "RolePermissions",
                column: "FeatureId");

            migrationBuilder.CreateIndex(
                name: "IX_RolePermissions_RoleId_FeatureId_Capability",
                table: "RolePermissions",
                columns: new[] { "RoleId", "FeatureId", "Capability" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Roles_Name",
                table: "Roles",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SetPasswordInvites_ExpiresAt",
                table: "SetPasswordInvites",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_SetPasswordInvites_TokenHash",
                table: "SetPasswordInvites",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SetPasswordInvites_UserId_UsedAt_RevokedAt",
                table: "SetPasswordInvites",
                columns: new[] { "UserId", "UsedAt", "RevokedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_UserPermissionOverrides_FeatureId",
                table: "UserPermissionOverrides",
                column: "FeatureId");

            migrationBuilder.CreateIndex(
                name: "IX_UserPermissionOverrides_UserId_FeatureId_Capability",
                table: "UserPermissionOverrides",
                columns: new[] { "UserId", "FeatureId", "Capability" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_Email",
                table: "Users",
                column: "Email",
                unique: true,
                filter: "\"IsDeleted\" = false");

            migrationBuilder.CreateIndex(
                name: "IX_Users_IsDeleted",
                table: "Users",
                column: "IsDeleted");

            migrationBuilder.CreateIndex(
                name: "IX_Users_Name",
                table: "Users",
                column: "Name");

            migrationBuilder.CreateIndex(
                name: "IX_Users_RoleId",
                table: "Users",
                column: "RoleId");

            migrationBuilder.CreateIndex(
                name: "IX_Users_Status",
                table: "Users",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ApprovalRequests");

            migrationBuilder.DropTable(
                name: "AuditLogs");

            migrationBuilder.DropTable(
                name: "CheckerAssignments");

            migrationBuilder.DropTable(
                name: "FeatureNavItems");

            migrationBuilder.DropTable(
                name: "HostNavItems");

            migrationBuilder.DropTable(
                name: "PermissionFeatureCapabilities");

            migrationBuilder.DropTable(
                name: "RefreshTokens");

            migrationBuilder.DropTable(
                name: "RemoteAppNavMetadata");

            migrationBuilder.DropTable(
                name: "RolePermissions");

            migrationBuilder.DropTable(
                name: "SetPasswordInvites");

            migrationBuilder.DropTable(
                name: "UserPermissionOverrides");

            migrationBuilder.DropTable(
                name: "NavSections");

            migrationBuilder.DropTable(
                name: "PermissionFeatures");

            migrationBuilder.DropTable(
                name: "Users");

            migrationBuilder.DropTable(
                name: "Roles");
        }
    }
}
