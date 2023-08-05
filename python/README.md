# GenniaBot python example

# only python

python main.py

# with C++

We use pybind11 to call a C++ class from Python, tutorial see : [pybind11 + python + cpp examples](https://github.com/tdegeus/pybind11_examples)

## How to build this demo

if you already clone this repo without `--recursive`, run command to download submodule pybind11

```
git submodule init
git submodule update
```

```
mkdir build
cd build
cmake ..
make
```

## Example test run

suppose you have built a example.xxx.so

```python
>>> from example import add, Pet
>>> add(2, 3)
5
>>> my_dog = Pet('Pluto', 5)
>>> my_dog.get_name()
'Pluto'
>>> my_dog.get_hunger()
5
>>> my_dog.go_for_a_walk()
>>> my_dog.get_hunger()
6
```

then import your so in main.py
