export const ApplicationName = 'angular_sample';

export const ReturnUrlType = 'returnUrl';

export const QueryParameterNames = {
	ReturnUrl: ReturnUrlType,
	Message: 'message'
};

export const LogoutActions = {
	LogoutCallback: 'logout-callback',
	Logout: 'logout',
	LoggedOut: 'logged-out'
};

export const LoginActions = {
	Login: 'login',
	LoginCallback: 'login-callback',
	LoginFailed: 'login-failed',
	Profile: 'profile',
	Register: 'register'
};

let applicationPaths: ApplicationPathsType = {
	DefaultLoginRedirectPath: '/',
	ApiAuthorizationClientConfigurationUrl: `https://localhost:44369/_configuration/${ApplicationName}`,
	Login: `https://localhost:44369/authentication/${LoginActions.Login}`,
	LoginFailed: `https://localhost:44369/authentication/${LoginActions.LoginFailed}`,
	LoginCallback: `https://localhost:44369/authentication/${LoginActions.LoginCallback}`,
	Register: `https://localhost:44369/authentication/${LoginActions.Register}`,
	Profile: `https://localhost:44369/authentication/${LoginActions.Profile}`,
	LogOut: `https://localhost:44369/authentication/${LogoutActions.Logout}`,
	LoggedOut: `https://localhost:44369/authentication/${LogoutActions.LoggedOut}`,
	LogOutCallback: `https://localhost:44369/authentication/${LogoutActions.LogoutCallback}`,
	LoginPathComponents: [],
	LoginFailedPathComponents: [],
	LoginCallbackPathComponents: [],
	RegisterPathComponents: [],
	ProfilePathComponents: [],
	LogOutPathComponents: [],
	LoggedOutPathComponents: [],
	LogOutCallbackPathComponents: [],
	IdentityRegisterPath: 'https://localhost:44369/Identity/Account/Register',
	IdentityManagePath: 'https://localhost:44369/Identity/Account/Manage'
};

applicationPaths = {
	...applicationPaths,
	LoginPathComponents: applicationPaths.Login.split('/'),
	LoginFailedPathComponents: applicationPaths.LoginFailed.split('/'),
	RegisterPathComponents: applicationPaths.Register.split('/'),
	ProfilePathComponents: applicationPaths.Profile.split('/'),
	LogOutPathComponents: applicationPaths.LogOut.split('/'),
	LoggedOutPathComponents: applicationPaths.LoggedOut.split('/'),
	LogOutCallbackPathComponents: applicationPaths.LogOutCallback.split('/')
};

interface ApplicationPathsType {
	readonly DefaultLoginRedirectPath: string;
	readonly ApiAuthorizationClientConfigurationUrl: string;
	readonly Login: string;
	readonly LoginFailed: string;
	readonly LoginCallback: string;
	readonly Register: string;
	readonly Profile: string;
	readonly LogOut: string;
	readonly LoggedOut: string;
	readonly LogOutCallback: string;
	readonly LoginPathComponents: string[];
	readonly LoginFailedPathComponents: string[];
	readonly LoginCallbackPathComponents: string[];
	readonly RegisterPathComponents: string[];
	readonly ProfilePathComponents: string[];
	readonly LogOutPathComponents: string[];
	readonly LoggedOutPathComponents: string[];
	readonly LogOutCallbackPathComponents: string[];
	readonly IdentityRegisterPath: string;
	readonly IdentityManagePath: string;
}

export const ApplicationPaths: ApplicationPathsType = applicationPaths;
