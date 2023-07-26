.PHONY: install
install:
	pip install -r requirements.txt

.PHONY: buildcpp
buildcpp:
	mkdir build
	cd build
	cmake ..
	make

.PHONY: run
run:
	python main.py