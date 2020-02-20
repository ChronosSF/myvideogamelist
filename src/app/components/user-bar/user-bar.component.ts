import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { first } from 'rxjs/operators';

import { AuthenticationService } from '../../services';
import { User } from '../../models';

@Component({
	selector: 'app-user-bar',
	templateUrl: 'user-bar.component.html'
})
export class UserBarComponent implements OnInit {

	constructor(public auth: AuthenticationService) { }

	public get userName(): string {
		return this.auth.currentUserValue.userName;
	}

	ngOnInit() {
	}
}