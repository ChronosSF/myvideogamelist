import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { first } from 'rxjs/operators';

import { AuthenticationService } from '../../services';

@Component({
	selector: 'app-top-bar',
	templateUrl: 'top-bar.component.html'
})
export class TopBarComponent implements OnInit {
	ngOnInit() {
	}
}